/* せーの！神輿バトル v2 — 3D描画の土台
 * ・描画パイプライン: シーン(HDR) → 光のにじみ(ブルーム) → 映画調の色調補正・周辺減光・粒子感
 * ・質感: 金の彫金/漆/白木/布/石畳/玉砂利を「色＋凹凸(法線)＋粗さ」でキャンバス生成
 * ・部品まとめ: 同じ素材の部品を1つに結合して描画回数を減らす（スマホ対策）
 * ・粒子: 火花・砂煙・紙吹雪・火の粉・花火 */
(function(){
  'use strict';
  var MK = window.MK = window.MK || {};
  var U = MK.util;
  var G = MK.gfx = {};
  var T = window.THREE;

  G.available = function(){ return !!window.THREE; };
  /* 色の指定（16進・CSS・HSL）は「画面で見える色」として書いているので、光の計算用（リニア）に直してから使う。
   * これをしないと全体が白く浮いて霞んだ見た目になる */
  if(T && !T.Color.prototype.__srgbPatched){
    var cp=T.Color.prototype, _hex=cp.setHex, _style=cp.setStyle, _hsl=cp.setHSL;
    cp.setHex=function(h){ _hex.call(this,h); return this.convertSRGBToLinear(); };
    cp.setStyle=function(s){ _style.call(this,s); return this.convertSRGBToLinear(); };
    cp.setHSL=function(h,s,l){ _hsl.call(this,h,s,l); return this.convertSRGBToLinear(); };
    cp.__srgbPatched=true;
  }

  /* ================= キャンバス道具 ================= */
  function canvas(w,h){ var c=document.createElement('canvas'); c.width=w; c.height=h; return c; }
  G.canvas = canvas;
  function ctx2d(c){ try{ return c.getContext('2d'); }catch(e){ return null; } }
  function toTex(c, srgb, repeat){
    var t=new T.CanvasTexture(c);
    if(srgb && T.sRGBEncoding!==undefined) t.encoding=T.sRGBEncoding;
    if(repeat){ t.wrapS=t.wrapT=T.RepeatWrapping; }
    t.anisotropy=G.maxAniso||1;
    t.needsUpdate=true;
    return t;
  }
  G.toTex = toTex;
  /* 高さ画像 → 法線マップ（Sobel）。画素を読めない環境では null */
  function heightToNormal(hc, strength){
    var cx=ctx2d(hc); if(!cx || !cx.getImageData) return null;
    var w=hc.width, h=hc.height, src;
    try{ src=cx.getImageData(0,0,w,h); }catch(e){ return null; }
    if(!src || !src.data) return null;
    var out=canvas(w,h), ox=ctx2d(out); if(!ox || !ox.createImageData) return null;
    var dst=ox.createImageData(w,h); if(!dst || !dst.data) return null;
    var s=src.data, d=dst.data, k=strength||2;
    function H(x,y){ x=(x+w)%w; y=(y+h)%h; return s[(y*w+x)*4]/255; }
    for(var y=0;y<h;y++){
      for(var x=0;x<w;x++){
        var dx=(H(x+1,y-1)+2*H(x+1,y)+H(x+1,y+1))-(H(x-1,y-1)+2*H(x-1,y)+H(x-1,y+1));
        var dy=(H(x-1,y+1)+2*H(x,y+1)+H(x+1,y+1))-(H(x-1,y-1)+2*H(x,y-1)+H(x+1,y-1));
        var nx=-dx*k, ny=dy*k, nz=1, l=Math.sqrt(nx*nx+ny*ny+nz*nz);
        var i=(y*w+x)*4;
        d[i]=(nx/l*0.5+0.5)*255; d[i+1]=(ny/l*0.5+0.5)*255; d[i+2]=(nz/l*0.5+0.5)*255; d[i+3]=255;
      }
    }
    ox.putImageData(dst,0,0);
    return out;
  }
  G.heightToNormal = heightToNormal;
  function noiseDots(cx, w, h, n, rMin, rMax, style){
    for(var i=0;i<n;i++){
      cx.fillStyle=typeof style==='function'?style(i):style;
      cx.beginPath(); cx.arc(Math.random()*w, Math.random()*h, rMin+Math.random()*(rMax-rMin), 0, Math.PI*2); cx.fill();
    }
  }

  /* ================= 質感テクスチャ（生成は1回だけ・キャッシュ） ================= */
  var TEX = {};
  /* 使い回す質感・素材の目印。場面の片付け（G.disposeTree）で捨てない */
  var SHARED = typeof WeakSet!=='undefined' ? new WeakSet() : null;
  G.markShared = function(o){
    if(!SHARED || !o) return o;
    if(o.isTexture || o.isMaterial) SHARED.add(o);
    else if(typeof o==='object') Object.keys(o).forEach(function(k){ if(o[k] && (o[k].isTexture||o[k].isMaterial)) SHARED.add(o[k]); });
    return o;
  };
  function cached(key, fn){ if(!TEX[key]) TEX[key]=G.markShared(fn()); return TEX[key]; }
  /* 「色・高さ・粗さ」を同じ筆で描く: draw(cx, layer) layer='color'|'height'|'rough' */
  function tripleTex(key, size, draw, normalStrength, rep){
    return cached(key, function(){
      var cc=canvas(size,size), hc=canvas(size,size), rc=canvas(size,size);
      var c1=ctx2d(cc), c2=ctx2d(hc), c3=ctx2d(rc);
      if(c1) draw(c1,'color',size); if(c2) draw(c2,'height',size); if(c3) draw(c3,'rough',size);
      var nc=heightToNormal(hc, normalStrength);
      return {
        map: toTex(cc, true, rep!==false),
        normalMap: nc ? toTex(nc, false, rep!==false) : null,
        roughnessMap: toTex(rc, false, rep!==false)
      };
    });
  }
  G.tex = {};
  /* 金の彫金: 七宝つなぎの地紋＋唐草の渦＋縁の鋲 */
  G.tex.gold = function(){
    return tripleTex('gold', 512, function(cx, L, S){
      var i, x, y;
      if(L==='color'){
        var g=cx.createLinearGradient(0,0,S,S);
        g.addColorStop(0,'#f2d27a'); g.addColorStop(0.5,'#d9ac45'); g.addColorStop(1,'#f0cc6e');
        cx.fillStyle=g; cx.fillRect(0,0,S,S);
      } else { cx.fillStyle=L==='height'?'#7a7a7a':'#4a4a4a'; cx.fillRect(0,0,S,S); }
      /* 七宝つなぎ（重なった円） */
      var step=S/8;
      cx.lineWidth=L==='height'?5:3.5;
      cx.strokeStyle=L==='color'?'rgba(120,80,14,0.55)':L==='height'?'#2a2a2a':'#8a8a8a';
      for(y=0;y<=8;y++) for(x=0;x<=8;x++){
        cx.beginPath(); cx.arc(x*step, y*step, step*0.707, 0, Math.PI*2); cx.stroke();
      }
      /* 盛り上がった円周（彫金の稜線） */
      cx.lineWidth=L==='height'?2:1.2;
      cx.strokeStyle=L==='color'?'rgba(255,240,190,0.7)':L==='height'?'#ffffff':'#262626';
      for(y=0;y<=8;y++) for(x=0;x<=8;x++){
        cx.beginPath(); cx.arc(x*step+1.5, y*step+1.5, step*0.707-2.5, 0, Math.PI*2); cx.stroke();
      }
      /* 花菱の芯 */
      for(y=0;y<8;y++) for(x=0;x<8;x++){
        var px=(x+0.5)*step, py=(y+0.5)*step;
        cx.fillStyle=L==='color'?'rgba(255,236,170,0.8)':L==='height'?'#f0f0f0':'#303030';
        cx.beginPath(); cx.arc(px,py,step*0.12,0,Math.PI*2); cx.fill();
        cx.fillStyle=L==='color'?'rgba(110,70,10,0.5)':L==='height'?'#303030':'#909090';
        cx.beginPath(); cx.arc(px,py,step*0.05,0,Math.PI*2); cx.fill();
      }
      /* 槌目（手打ちの細かい凹凸） */
      if(L!=='rough'){
        noiseDots(cx,S,S,1800,1,2.6,function(){
          return L==='color' ? 'rgba(255,238,180,'+(0.04+Math.random()*0.08)+')' : 'rgba(255,255,255,'+(0.05+Math.random()*0.1)+')';
        });
      } else {
        noiseDots(cx,S,S,900,1,3,function(){ return 'rgba(120,120,120,'+(0.1+Math.random()*0.2)+')'; });
      }
    }, 3.2);
  };
  /* 漆: ほぼ鏡面。ごく緩いうねり（柚子肌）と蒔絵の金粉 */
  G.tex.lacquer = function(){
    return tripleTex('lacquer', 256, function(cx, L, S){
      if(L==='color'){
        var g=cx.createLinearGradient(0,0,S,S);
        g.addColorStop(0,'#1d1726'); g.addColorStop(0.5,'#110d18'); g.addColorStop(1,'#1b1524');
        cx.fillStyle=g; cx.fillRect(0,0,S,S);
        noiseDots(cx,S,S,160,0.6,1.3,function(){ return 'rgba(230,190,90,'+(0.08+Math.random()*0.2)+')'; });
      } else if(L==='height'){
        cx.fillStyle='#808080'; cx.fillRect(0,0,S,S);
        noiseDots(cx,S,S,60,14,34,function(){ return 'rgba('+(Math.random()<0.5?255:0)+','+(Math.random()<0.5?255:0)+',128,0.04)'; });
      } else {
        cx.fillStyle='#262626'; cx.fillRect(0,0,S,S);
        noiseDots(cx,S,S,200,2,6,function(){ return 'rgba(80,80,80,0.25)'; });
      }
    }, 1.2);
  };
  /* 檜の白木: 柾目の木目 */
  function woodDraw(base, dark){
    return function(cx, L, S){
      var rng=U.rng(1234);
      if(L==='color'){ cx.fillStyle=base; cx.fillRect(0,0,S,S); }
      else { cx.fillStyle=L==='height'?'#909090':'#a8a8a8'; cx.fillRect(0,0,S,S); }
      for(var i=0;i<70;i++){
        var y=rng()*S, amp=2+rng()*5, fr=0.004+rng()*0.01, w=0.6+rng()*2.4;
        cx.strokeStyle= L==='color' ? 'rgba('+dark+','+(0.12+rng()*0.25)+')' : L==='height' ? 'rgba(40,40,40,'+(0.25+rng()*0.3)+')' : 'rgba(210,210,210,0.35)';
        cx.lineWidth=w;
        cx.beginPath();
        for(var x=0;x<=S;x+=8){
          var yy=y+Math.sin(x*fr+i)*amp+Math.sin(x*fr*3.1)*amp*0.3;
          if(x===0) cx.moveTo(x,yy); else cx.lineTo(x,yy);
        }
        cx.stroke();
      }
    };
  }
  G.tex.wood = function(){ return tripleTex('wood', 256, woodDraw('#e6d2a6','120,82,40'), 1.6); };
  G.tex.woodDark = function(){ return tripleTex('woodDark', 256, woodDraw('#8a5e36','50,26,10'), 1.8); };
  /* 織り布（緞子）: 綾織りの凹凸。色はマテリアル側で着ける */
  G.tex.fabric = function(){
    return tripleTex('fabric', 256, function(cx, L, S){
      cx.fillStyle=L==='color'?'#f4f0ea':L==='height'?'#808080':'#c0c0c0'; cx.fillRect(0,0,S,S);
      var n=48, st=S/n;
      for(var y=0;y<n;y++) for(var x=0;x<n;x++){
        var on=((x+y)%4)<2;
        if(L==='color') cx.fillStyle=on?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.12)';
        else if(L==='height') cx.fillStyle=on?'#c8c8c8':'#404040';
        else cx.fillStyle=on?'#b0b0b0':'#d8d8d8';
        cx.fillRect(x*st+0.5,y*st+0.5,st-1,st-1);
      }
      if(L==='color'){
        /* 雲文の地紋 */
        cx.strokeStyle='rgba(255,255,255,0.22)'; cx.lineWidth=3;
        for(var k=0;k<6;k++){
          var cx0=(k%3)*S/3+S/6, cy0=Math.floor(k/3)*S/2+S/4;
          for(var r=10;r<40;r+=10){ cx.beginPath(); cx.arc(cx0,cy0,r,Math.PI,Math.PI*2); cx.stroke(); }
        }
      }
    }, 2.2);
  };
  /* 石畳 */
  G.tex.stone = function(){
    return tripleTex('stone', 512, function(cx, L, S){
      var rng=U.rng(99);
      cx.fillStyle=L==='color'?'#4a4552':L==='height'?'#202020':'#e0e0e0'; cx.fillRect(0,0,S,S);
      var rows=4, rh=S/rows;
      for(var r=0;r<rows;r++){
        var x=-(r%2)*S/6, cols=3;
        for(var c=0;c<=cols;c++){
          var w=S/3;
          var shade=0.8+rng()*0.4;
          if(L==='color'){
            var base=[118,112,124].map(function(v){ return Math.round(v*shade); });
            cx.fillStyle='rgb('+base.join(',')+')';
          } else if(L==='height') cx.fillStyle='#b8b8b8';
          else cx.fillStyle='rgb('+Math.round(170+rng()*50)+','+Math.round(170+rng()*50)+','+Math.round(170+rng()*50)+')';
          cx.fillRect(x+c*w+4, r*rh+4, w-8, rh-8);
          /* 面取りのハイライト */
          if(L==='height'){
            cx.fillStyle='#d8d8d8'; cx.fillRect(x+c*w+10, r*rh+10, w-20, rh-20);
          }
        }
      }
      noiseDots(cx,S,S,2600,0.6,2.2,function(){
        return L==='color'?'rgba('+(Math.random()<0.5?255:0)+','+(Math.random()<0.5?255:0)+','+(Math.random()<0.5?255:0)+',0.06)':
          L==='height'?'rgba(0,0,0,0.15)':'rgba(255,255,255,0.1)';
      });
    }, 2.6);
  };
  /* 玉砂利 */
  G.tex.gravel = function(){
    return tripleTex('gravel', 512, function(cx, L, S){
      var rng=U.rng(7);
      cx.fillStyle=L==='color'?'#6f6a70':L==='height'?'#303030':'#d8d8d8'; cx.fillRect(0,0,S,S);
      for(var i=0;i<5200;i++){
        var x=rng()*S, y=rng()*S, r=2+rng()*4.5, v=rng();
        if(L==='color'){ var c=Math.round(140+v*80); cx.fillStyle='rgb('+c+','+(c-6)+','+(c-2)+')'; }
        else if(L==='height'){ var g=cx.createRadialGradient(x-r*0.3,y-r*0.3,0,x,y,r); g.addColorStop(0,'#ffffff'); g.addColorStop(1,'#303030'); cx.fillStyle=g; }
        else cx.fillStyle='rgb('+Math.round(150+v*80)+',0,0)';
        cx.beginPath(); cx.ellipse(x,y,r,r*(0.7+rng()*0.3),rng()*3,0,Math.PI*2); cx.fill();
      }
    }, 3.0);
  };
  /* 瓦・銅板の屋根（筋） */
  G.tex.roofTile = function(){
    return tripleTex('roofTile', 256, function(cx, L, S){
      cx.fillStyle=L==='color'?'#2a2a36':L==='height'?'#606060':'#9a9a9a'; cx.fillRect(0,0,S,S);
      var n=16, st=S/n;
      for(var i=0;i<n;i++){
        var g=cx.createLinearGradient(i*st,0,(i+1)*st,0);
        if(L==='color'){ g.addColorStop(0,'#1c1c26'); g.addColorStop(0.5,'#3d3d4c'); g.addColorStop(1,'#1c1c26'); }
        else if(L==='height'){ g.addColorStop(0,'#202020'); g.addColorStop(0.5,'#ffffff'); g.addColorStop(1,'#202020'); }
        else { g.addColorStop(0,'#c0c0c0'); g.addColorStop(0.5,'#707070'); g.addColorStop(1,'#c0c0c0'); }
        cx.fillStyle=g; cx.fillRect(i*st,0,st,S);
      }
      for(var y=0;y<S;y+=S/8){
        cx.fillStyle=L==='color'?'rgba(0,0,0,0.35)':L==='height'?'rgba(0,0,0,0.5)':'rgba(255,255,255,0.2)';
        cx.fillRect(0,y,S,3);
      }
    }, 2.0);
  };
  /* 漆喰の白壁・格子戸（拝殿用） */
  G.tex.shoji = function(){
    return cached('shoji', function(){
      var S=256, c=canvas(S,S), cx=ctx2d(c);
      if(cx){
        cx.fillStyle='#f3e6c8'; cx.fillRect(0,0,S,S);
        var g=cx.createRadialGradient(S/2,S/2,10,S/2,S/2,S*0.7); g.addColorStop(0,'rgba(255,190,110,0.55)'); g.addColorStop(1,'rgba(255,160,80,0)');
        cx.fillStyle=g; cx.fillRect(0,0,S,S);
        cx.strokeStyle='#3a2414'; cx.lineWidth=6;
        for(var i=0;i<=4;i++){ cx.beginPath(); cx.moveTo(i*S/4,0); cx.lineTo(i*S/4,S); cx.stroke(); }
        cx.lineWidth=4;
        for(i=0;i<=6;i++){ cx.beginPath(); cx.moveTo(0,i*S/6); cx.lineTo(S,i*S/6); cx.stroke(); }
      }
      return toTex(c, true, true);
    });
  };
  /* 提灯の和紙（骨の筋＋文字）。発光マップとして使う */
  G.tex.lantern = function(color, ch){
    var key='lantern_'+color+'_'+(ch||'');
    return cached(key, function(){
      var W=128, H=128, c=canvas(W,H), cx=ctx2d(c);
      if(cx){
        var base=U.hex(color);
        cx.fillStyle=base; cx.fillRect(0,0,W,H);
        var g=cx.createLinearGradient(0,0,W,0);
        g.addColorStop(0,'rgba(0,0,0,0.35)'); g.addColorStop(0.5,'rgba(255,255,255,0.25)'); g.addColorStop(1,'rgba(0,0,0,0.35)');
        cx.fillStyle=g; cx.fillRect(0,0,W,H);
        cx.strokeStyle='rgba(60,20,8,0.4)'; cx.lineWidth=2;
        for(var i=1;i<10;i++){ cx.beginPath(); cx.moveTo(0,i*H/10); cx.lineTo(W,i*H/10); cx.stroke(); }
        if(ch){
          cx.fillStyle='rgba(40,10,4,0.85)'; cx.font='bold 54px "Hiragino Mincho ProN","Yu Mincho",serif';
          cx.textAlign='center'; cx.textBaseline='middle';
          cx.fillText(ch, W*0.25, H/2); cx.fillText(ch, W*0.75, H/2);
        }
      }
      return toTex(c, true, false);
    });
  };
  /* 光のにじみ用の丸いぼかし */
  G.tex.glow = function(){
    return cached('glow', function(){
      var S=64, c=canvas(S,S), cx=ctx2d(c);
      if(cx){
        var g=cx.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
        g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.25,'rgba(255,255,255,0.55)');
        g.addColorStop(0.6,'rgba(255,255,255,0.12)'); g.addColorStop(1,'rgba(255,255,255,0)');
        cx.fillStyle=g; cx.fillRect(0,0,S,S);
      }
      return toTex(c, false, false);
    });
  };
  G.tex.petal = function(){
    return cached('petal', function(){
      var S=32, c=canvas(S,S), cx=ctx2d(c);
      if(cx){
        cx.fillStyle='#fff';
        cx.beginPath(); cx.ellipse(S/2,S/2,S*0.42,S*0.26,0.6,0,Math.PI*2); cx.fill();
      }
      return toTex(c, false, false);
    });
  };
  G.tex.square = function(){
    return cached('square', function(){
      var S=16, c=canvas(S,S), cx=ctx2d(c);
      if(cx){ cx.fillStyle='#fff'; cx.fillRect(3,2,10,12); }
      return toTex(c, false, false);
    });
  };
  /* 夕焼けの空（正距円筒）。背景と映り込みの両方に使う */
  G.tex.sky = function(){
    return cached('sky', function(){
      var W=1024, H=512, c=canvas(W,H), cx=ctx2d(c);
      if(cx){
        var g=cx.createLinearGradient(0,0,0,H);
        g.addColorStop(0.00,'#141233'); g.addColorStop(0.22,'#2a2458');
        g.addColorStop(0.38,'#5b3c78'); g.addColorStop(0.46,'#a4506a');
        g.addColorStop(0.495,'#f08a4c'); g.addColorStop(0.505,'#ffb766');
        g.addColorStop(0.52,'#6a3a4a'); g.addColorStop(0.62,'#2a1c24'); g.addColorStop(1,'#120c10');
        cx.fillStyle=g; cx.fillRect(0,0,W,H);
        /* 夕陽のにじみ（正面=u0.75付近に置く） */
        var sx=W*0.75, sy=H*0.49;
        var sg=cx.createRadialGradient(sx,sy,0,sx,sy,W*0.28);
        sg.addColorStop(0,'rgba(255,214,140,0.95)'); sg.addColorStop(0.15,'rgba(255,150,80,0.55)'); sg.addColorStop(1,'rgba(255,120,80,0)');
        cx.fillStyle=sg; cx.fillRect(0,0,W,H);
        /* たなびく雲 */
        var rng=U.rng(4242);
        for(var i=0;i<46;i++){
          var x=rng()*W, y=H*(0.25+rng()*0.2), w=60+rng()*220, h=4+rng()*9;
          var lit=1-Math.abs((x-sx)/W)*2;
          cx.fillStyle='rgba('+Math.round(150+105*lit)+','+Math.round(80+60*lit)+','+Math.round(110-10*lit)+','+(0.18+rng()*0.25)+')';
          cx.beginPath(); cx.ellipse(x,y,w,h,0,0,Math.PI*2); cx.fill();
          cx.beginPath(); cx.ellipse(x-W,y,w,h,0,0,Math.PI*2); cx.fill();
        }
        /* 星 */
        for(i=0;i<160;i++){
          cx.fillStyle='rgba(255,250,235,'+(0.3+rng()*0.6)+')';
          cx.fillRect(rng()*W, rng()*H*0.3, 1.2, 1.2);
        }
        /* 月 */
        cx.fillStyle='#fff6dc'; cx.beginPath(); cx.arc(W*0.32,H*0.16,11,0,Math.PI*2); cx.fill();
        var mg=cx.createRadialGradient(W*0.32,H*0.16,0,W*0.32,H*0.16,50);
        mg.addColorStop(0,'rgba(255,240,210,0.4)'); mg.addColorStop(1,'rgba(255,240,210,0)');
        cx.fillStyle=mg; cx.fillRect(W*0.32-50,H*0.16-50,100,100);
      }
      var t=toTex(c, true, false);
      t.mapping=T.EquirectangularReflectionMapping;
      return t;
    });
  };
  /* 映り込み専用の環境画像: 空＋提灯の明るい点（金が「祭りの夜」を映すように） */
  function envCanvas(){
    var W=512, H=256, c=canvas(W,H), cx=ctx2d(c);
    if(!cx) return null;
    var g=cx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#0e0b20'); g.addColorStop(0.35,'#2a1e44'); g.addColorStop(0.47,'#7a4a52'); g.addColorStop(0.49,'#e08048');
    g.addColorStop(0.52,'#3a2220'); g.addColorStop(1,'#0c0808');
    cx.fillStyle=g; cx.fillRect(0,0,W,H);
    var rng=U.rng(77);
    for(var i=0;i<34;i++){
      var x=rng()*W, y=H*(0.4+rng()*0.16), r=3+rng()*6;
      var lg=cx.createRadialGradient(x,y,0,x,y,r*3);
      lg.addColorStop(0,'rgba(255,220,150,1)'); lg.addColorStop(0.3,'rgba(255,140,60,0.7)'); lg.addColorStop(1,'rgba(255,100,40,0)');
      cx.fillStyle=lg; cx.fillRect(x-r*3,y-r*3,r*6,r*6);
    }
    /* 上からの柔らかい光（金の上面を明るく見せる） */
    var tg=cx.createRadialGradient(W*0.5,0,0,W*0.5,0,H*0.5);
    tg.addColorStop(0,'rgba(180,170,240,0.35)'); tg.addColorStop(1,'rgba(180,170,240,0)');
    cx.fillStyle=tg; cx.fillRect(0,0,W,H*0.6);
    return c;
  }

  /* ================= 素材（マテリアル） ================= */
  var MAT = {};
  function mcached(key, fn){ if(!MAT[key]) MAT[key]=G.markShared(fn()); return MAT[key]; }
  function std(o){ return new T.MeshStandardMaterial(o); }
  G.mat = {
    gold: function(){ return mcached('gold', function(){ var t=G.tex.gold(); return std({ color:0xffe2a0, map:t.map, normalMap:t.normalMap, normalScale:new T.Vector2(0.8,0.8), roughnessMap:t.roughnessMap, metalness:1.0, roughness:0.55, envMapIntensity:1.15 }); }); },
    goldBright: function(){ return mcached('goldBright', function(){ return std({ color:0xffd98a, metalness:1.0, roughness:0.26, envMapIntensity:1.1, emissive:0x2a1804, emissiveIntensity:0.25 }); }); },
    goldAged: function(){ return mcached('goldAged', function(){ var t=G.tex.gold(); return std({ color:0xc9a24b, map:t.map, normalMap:t.normalMap, roughnessMap:t.roughnessMap, metalness:1.0, roughness:0.75, envMapIntensity:1.0 }); }); },
    lacquer: function(){ return mcached('lacquer', function(){ var t=G.tex.lacquer(); return std({ color:0xffffff, map:t.map, normalMap:t.normalMap, normalScale:new T.Vector2(0.35,0.35), metalness:0.0, roughness:0.12, envMapIntensity:0.5 }); }); },
    shu: function(){ return mcached('shu', function(){ var t=G.tex.lacquer(); return std({ color:0xc8331f, normalMap:t.normalMap, normalScale:new T.Vector2(0.3,0.3), metalness:0.0, roughness:0.28, envMapIntensity:0.45 }); }); },
    shuMatte: function(){ return mcached('shuMatte', function(){ return std({ color:0xb5321e, metalness:0.0, roughness:0.62, envMapIntensity:0.4 }); }); },
    ivory: function(){ return mcached('ivory', function(){ var t=G.tex.lacquer(); return std({ color:0xeadcbc, normalMap:t.normalMap, normalScale:new T.Vector2(0.3,0.3), metalness:0.0, roughness:0.34, envMapIntensity:0.45 }); }); },
    wood: function(){ return mcached('wood', function(){ var t=G.tex.wood(); return std({ color:0xffffff, map:t.map, normalMap:t.normalMap, roughnessMap:t.roughnessMap, metalness:0, roughness:0.72, envMapIntensity:0.5 }); }); },
    woodDark: function(){ return mcached('woodDark', function(){ var t=G.tex.woodDark(); return std({ color:0xffffff, map:t.map, normalMap:t.normalMap, roughnessMap:t.roughnessMap, metalness:0, roughness:0.7, envMapIntensity:0.45 }); }); },
    fabric: function(hex){ return mcached('fabric'+hex, function(){ var t=G.tex.fabric(); return std({ color:hex, map:t.map, normalMap:t.normalMap, roughnessMap:t.roughnessMap, metalness:0, roughness:0.85, envMapIntensity:0.5 }); }); },
    rope: function(hex){ return mcached('rope'+hex, function(){ var t=G.tex.fabric(); return std({ color:hex, normalMap:t.normalMap, normalScale:new T.Vector2(1.4,1.4), metalness:0, roughness:0.9, envMapIntensity:0.4 }); }); },
    plain: function(hex, rough, metal){ var k='plain'+hex+'_'+rough+'_'+metal; return mcached(k, function(){ return std({ color:hex, roughness:rough===undefined?0.7:rough, metalness:metal||0, envMapIntensity:0.35 }); }); },
    glow: function(hex, intensity){ var k='glow'+hex+'_'+intensity; return mcached(k, function(){ return std({ color:hex, emissive:hex, emissiveIntensity:intensity||2, roughness:0.6 }); }); },
    lanternPaper: function(hex, ch){ var k='lp'+hex+(ch||''); return mcached(k, function(){ var t=G.tex.lantern(hex, ch); return std({ color:0xffffff, map:t, emissive:0xffffff, emissiveMap:t, emissiveIntensity:1.6, roughness:0.7 }); }); },
    stone: function(){ return mcached('stone', function(){ var t=G.tex.stone(); return std({ color:0x7d7682, map:t.map, normalMap:t.normalMap, roughnessMap:t.roughnessMap, metalness:0, roughness:0.9, envMapIntensity:0.3 }); }); },
    stoneBlock: function(){ return mcached('stoneBlock', function(){ var t=G.tex.gravel(); return std({ color:0x6e6964, normalMap:t.normalMap, normalScale:new T.Vector2(0.5,0.5), metalness:0, roughness:0.92, envMapIntensity:0.3 }); }); },
    gravel: function(){ return mcached('gravel', function(){ var t=G.tex.gravel(); return std({ color:0x6f686c, map:t.map, normalMap:t.normalMap, roughnessMap:t.roughnessMap, metalness:0, roughness:0.95, envMapIntensity:0.3 }); }); },
    roofTile: function(){ return mcached('roofTile', function(){ var t=G.tex.roofTile(); return std({ color:0xffffff, map:t.map, normalMap:t.normalMap, roughnessMap:t.roughnessMap, metalness:0.3, roughness:0.55, envMapIntensity:0.5 }); }); },
    shoji: function(){ return mcached('shoji', function(){ var t=G.tex.shoji(); return std({ color:0xffffff, map:t, emissive:0xffffff, emissiveMap:t, emissiveIntensity:0.9, roughness:0.8 }); }); }
  };
  /* テクスチャの繰り返し回数を変えたい時は複製して使う */
  G.withRepeat = function(mat, rx, ry){
    var m=mat.clone();
    ['map','normalMap','roughnessMap'].forEach(function(k){
      if(m[k]){ m[k]=m[k].clone(); m[k].needsUpdate=true; m[k].repeat.set(rx,ry); m[k].wrapS=m[k].wrapT=T.RepeatWrapping; }
    });
    return m;
  };

  /* 同じ素材・同じ繰り返しの複製を1つだけ作って使い回す（場面の片付けで捨てない） */
  G.withRepeatShared = function(mat, rx, ry){
    return mcached('rep_'+mat.uuid+'_'+rx+'_'+ry, function(){ return G.withRepeat(mat, rx, ry); });
  };

  /* ================= 部品まとめ（同じ素材を1つのメッシュへ） ================= */
  function mergeGeometries(list){
    var vCount=0, iCount=0;
    list.forEach(function(it){
      var g=it.geo, n=g.attributes.position.count;
      vCount+=n; iCount+=g.index?g.index.count:n;
    });
    var pos=new Float32Array(vCount*3), nor=new Float32Array(vCount*3), uv=new Float32Array(vCount*2);
    var idx=vCount>65535?new Uint32Array(iCount):new Uint16Array(iCount);
    var hasCol=list.some(function(it){ return !!it.geo.attributes.color; });
    var col=hasCol?new Float32Array(vCount*3):null;
    var vOff=0, iOff=0, v=new T.Vector3(), nm=new T.Matrix3();
    list.forEach(function(it){
      var g=it.geo, m=it.matrix, n=g.attributes.position.count;
      nm.getNormalMatrix(m);
      var P=g.attributes.position, N=g.attributes.normal, UV=g.attributes.uv, CL=g.attributes.color;
      for(var i=0;i<n;i++){
        v.fromBufferAttribute(P,i).applyMatrix4(m);
        pos[(vOff+i)*3]=v.x; pos[(vOff+i)*3+1]=v.y; pos[(vOff+i)*3+2]=v.z;
        if(N){ v.fromBufferAttribute(N,i).applyMatrix3(nm).normalize(); nor[(vOff+i)*3]=v.x; nor[(vOff+i)*3+1]=v.y; nor[(vOff+i)*3+2]=v.z; }
        if(UV){ uv[(vOff+i)*2]=UV.getX(i); uv[(vOff+i)*2+1]=UV.getY(i); }
        if(col){
          if(CL){ col[(vOff+i)*3]=CL.getX(i); col[(vOff+i)*3+1]=CL.getY(i); col[(vOff+i)*3+2]=CL.getZ(i); }
          else { col[(vOff+i)*3]=1; col[(vOff+i)*3+1]=1; col[(vOff+i)*3+2]=1; }
        }
      }
      if(g.index){ var I=g.index; for(var k=0;k<I.count;k++) idx[iOff+k]=I.getX(k)+vOff; iOff+=I.count; }
      else { for(k=0;k<n;k++) idx[iOff+k]=k+vOff; iOff+=n; }
      /* 行列が裏返し（負のスケール）の時は面の向きを戻す */
      if(m.determinant()<0){
        var start=iOff-(g.index?g.index.count:n);
        for(k=start;k<iOff;k+=3){ var tmp=idx[k+1]; idx[k+1]=idx[k+2]; idx[k+2]=tmp; }
      }
      vOff+=n;
    });
    var out=new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos,3));
    out.setAttribute('normal', new T.BufferAttribute(nor,3));
    out.setAttribute('uv', new T.BufferAttribute(uv,2));
    if(col) out.setAttribute('color', new T.BufferAttribute(col,3));
    out.setIndex(new T.BufferAttribute(idx,1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  G.mergeGeometries = mergeGeometries;
  /* root 以下のメッシュを素材ごとに結合する。userData.keep の付いた枝は動かすので結合しない */
  G.mergeGroup = function(root, opts){
    opts=opts||{};
    root.updateMatrixWorld(true);
    var inv=new T.Matrix4().copy(root.matrixWorld).invert();
    var byMat={}, keeps=[];
    (function walk(o){
      for(var i=0;i<o.children.length;i++){
        var c=o.children[i];
        if(c.userData && c.userData.keep){ keeps.push(c); continue; }
        if(c.isMesh && !c.isSkinnedMesh && c.geometry && c.geometry.attributes.position){
          var key=c.material.uuid;
          (byMat[key]=byMat[key]||{ mat:c.material, list:[] }).list.push({ geo:c.geometry, matrix:new T.Matrix4().multiplyMatrices(inv, c.matrixWorld) });
        } else if(c.isLight || c.isPoints || c.isSprite){ keeps.push(c); continue; }
        walk(c);
      }
    })(root);
    var out=new T.Group(); out.name=root.name;
    Object.keys(byMat).forEach(function(k){
      var e=byMat[k], mesh=new T.Mesh(mergeGeometries(e.list), e.mat);
      mesh.castShadow=opts.castShadow!==false; mesh.receiveShadow=!!opts.receiveShadow;
      out.add(mesh);
    });
    keeps.forEach(function(k){
      var m=new T.Matrix4().multiplyMatrices(inv, k.matrixWorld);
      if(k.parent) k.parent.remove(k);
      m.decompose(k.position, k.quaternion, k.scale);
      out.add(k);
    });
    return out;
  };
  /* 場面から外した部品の GPU 資源を捨てる（使い回しの質感・素材は残す） */
  var TEX_KEYS=['map','normalMap','roughnessMap','emissiveMap','bumpMap','metalnessMap','aoMap','alphaMap'];
  G.disposeTree = function(root){
    if(!root) return;
    var seen=new Set();
    function disposeMat(m){
      if(!m || seen.has(m) || (SHARED && SHARED.has(m))) return;
      seen.add(m);
      TEX_KEYS.forEach(function(k){ var t=m[k]; if(t && !seen.has(t) && !(SHARED && SHARED.has(t))){ seen.add(t); t.dispose(); } });
      m.dispose();
    }
    root.traverse(function(o){
      if(o.geometry && !seen.has(o.geometry)){ seen.add(o.geometry); o.geometry.dispose(); }
      if(o.material) (Array.isArray(o.material)?o.material:[o.material]).forEach(disposeMat);
      if(o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
      if(o.isInstancedMesh && o.dispose) o.dispose();
    });
  };
  /* group の中身を素材ごとに結合し直す（group 自体の位置・回転は残すので揺らせる） */
  G.mergeInPlace = function(group){
    var saved={ p:group.position.clone(), q:group.quaternion.clone(), s:group.scale.clone(), parent:group.parent };
    if(saved.parent) saved.parent.remove(group);
    group.position.set(0,0,0); group.quaternion.identity(); group.scale.set(1,1,1);
    group.updateMatrixWorld(true);
    var merged=G.mergeGroup(group, { castShadow:false });
    while(group.children.length) group.remove(group.children[0]);
    merged.children.slice().forEach(function(c){ group.add(c); });
    group.position.copy(saved.p); group.quaternion.copy(saved.q); group.scale.copy(saved.s);
    if(saved.parent) saved.parent.add(group);
    return group;
  };
  /* 手早く部品を置くための道具 */
  G.part = function(parent, geo, mat, x, y, z, rx, ry, rz, sx, sy, sz){
    var m=new T.Mesh(geo, mat);
    m.position.set(x||0, y||0, z||0);
    if(rx||ry||rz) m.rotation.set(rx||0, ry||0, rz||0);
    if(sx!==undefined) m.scale.set(sx, sy===undefined?sx:sy, sz===undefined?sx:sz);
    parent.add(m);
    return m;
  };

  /* ================= 粒子（火花・砂煙・紙吹雪・火の粉・花火） ================= */
  var PVS=[
    'attribute float psize; attribute vec4 pcolor; attribute float prot;',
    'uniform float uScale; varying vec4 vC; varying float vR;',
    'void main(){ vC=pcolor; vR=prot; vec4 mv=modelViewMatrix*vec4(position,1.0);',
    '  gl_PointSize=max(1.0, psize*uScale/max(0.1,-mv.z)); gl_Position=projectionMatrix*mv; }'
  ].join('\n');
  var PFS=[
    'uniform sampler2D map; varying vec4 vC; varying float vR;',
    'void main(){ vec2 p=gl_PointCoord-0.5; float c=cos(vR), s=sin(vR);',
    '  vec2 q=vec2(c*p.x-s*p.y, s*p.x+c*p.y)+0.5; vec4 t=texture2D(map,q);',
    '  if(t.a*vC.a<0.01) discard; gl_FragColor=vec4(vC.rgb*t.rgb, t.a*vC.a); }'
  ].join('\n');
  G.Particles = function(max, texture, additive){
    this.max=max; this.n=0;
    this.p=new Float32Array(max*3); this.v=new Float32Array(max*3);
    this.life=new Float32Array(max); this.age=new Float32Array(max);
    this.size=new Float32Array(max); this.size0=new Float32Array(max);
    this.col=new Float32Array(max*4); this.rot=new Float32Array(max); this.spin=new Float32Array(max);
    this.drag=new Float32Array(max); this.grav=new Float32Array(max); this.flutter=new Float32Array(max);
    var g=new T.BufferGeometry();
    this.aPos=new T.BufferAttribute(this.p,3); this.aPos.setUsage(T.DynamicDrawUsage);
    this.aSize=new T.BufferAttribute(new Float32Array(max),1); this.aSize.setUsage(T.DynamicDrawUsage);
    this.aCol=new T.BufferAttribute(new Float32Array(max*4),4); this.aCol.setUsage(T.DynamicDrawUsage);
    this.aRot=new T.BufferAttribute(this.rot,1); this.aRot.setUsage(T.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('psize', this.aSize);
    g.setAttribute('pcolor', this.aCol); g.setAttribute('prot', this.aRot);
    g.setDrawRange(0,0);
    this.mat=new T.ShaderMaterial({
      uniforms:{ map:{ value:texture||G.tex.glow() }, uScale:{ value:G.pointScale||400 } },
      vertexShader:PVS, fragmentShader:PFS, transparent:true, depthWrite:false,
      blending:additive?T.AdditiveBlending:T.NormalBlending
    });
    this.points=new T.Points(g, this.mat);
    this.points.frustumCulled=false;
    this.points.renderOrder=10;
    G._particleSets.push(this);
  };
  G._particleSets=[];
  G.Particles.prototype.emit=function(o){
    if(this.n>=this.max){ /* 一番古いものを上書き */ this.kill(0); }
    var i=this.n++;
    this.p[i*3]=o.x; this.p[i*3+1]=o.y; this.p[i*3+2]=o.z;
    this.v[i*3]=o.vx||0; this.v[i*3+1]=o.vy||0; this.v[i*3+2]=o.vz||0;
    this.life[i]=o.life||1; this.age[i]=0; this.size0[i]=o.size||0.1; this.size[i]=o.sizeEnd===undefined?o.size||0.1:o.sizeEnd;
    var c=o.color||[1,1,1,1];
    this.col[i*4]=c[0]; this.col[i*4+1]=c[1]; this.col[i*4+2]=c[2]; this.col[i*4+3]=c[3]===undefined?1:c[3];
    this.rot[i]=o.rot||Math.random()*6.28; this.spin[i]=o.spin||0;
    this.drag[i]=o.drag||0; this.grav[i]=o.grav===undefined?0:o.grav; this.flutter[i]=o.flutter||0;
  };
  G.Particles.prototype.kill=function(i){
    var j=--this.n; if(i===j) return;
    var s=this;
    function cp(arr,k){ for(var q=0;q<k;q++) arr[i*k+q]=arr[j*k+q]; }
    cp(s.p,3); cp(s.v,3); cp(s.col,4);
    s.life[i]=s.life[j]; s.age[i]=s.age[j]; s.size[i]=s.size[j]; s.size0[i]=s.size0[j];
    s.rot[i]=s.rot[j]; s.spin[i]=s.spin[j]; s.drag[i]=s.drag[j]; s.grav[i]=s.grav[j]; s.flutter[i]=s.flutter[j];
  };
  G.Particles.prototype.update=function(dt){
    var S=this.aSize.array, CA=this.aCol.array;
    for(var i=0;i<this.n;i++){
      this.age[i]+=dt;
      if(this.age[i]>=this.life[i]){ this.kill(i); i--; continue; }
      var t=this.age[i]/this.life[i], dr=Math.exp(-this.drag[i]*dt);
      this.v[i*3]*=dr; this.v[i*3+1]=this.v[i*3+1]*dr-this.grav[i]*dt; this.v[i*3+2]*=dr;
      if(this.flutter[i]){ this.v[i*3]+=Math.sin(this.age[i]*6+i)*this.flutter[i]*dt; this.v[i*3+2]+=Math.cos(this.age[i]*5+i)*this.flutter[i]*dt; }
      this.p[i*3]+=this.v[i*3]*dt; this.p[i*3+1]+=this.v[i*3+1]*dt; this.p[i*3+2]+=this.v[i*3+2]*dt;
      this.rot[i]+=this.spin[i]*dt;
      S[i]=this.size0[i]+(this.size[i]-this.size0[i])*t;
      var fade=t<0.1?t/0.1:1-Math.pow((t-0.1)/0.9,1.6);
      CA[i*4]=this.col[i*4]; CA[i*4+1]=this.col[i*4+1]; CA[i*4+2]=this.col[i*4+2]; CA[i*4+3]=this.col[i*4+3]*fade;
    }
    this.points.geometry.setDrawRange(0,this.n);
    this.aPos.needsUpdate=true; this.aSize.needsUpdate=true; this.aCol.needsUpdate=true; this.aRot.needsUpdate=true;
  };
  G.Particles.prototype.clear=function(){ this.n=0; this.points.geometry.setDrawRange(0,0); };
  G.Particles.prototype.dispose=function(){
    var i=G._particleSets.indexOf(this); if(i>=0) G._particleSets.splice(i,1);
    this.points.geometry.dispose(); this.mat.dispose();
  };
  /* よく使う出し方 */
  G.fx = {
    sparks: function(ps, x, y, z, n, power){
      power=power||1;
      for(var i=0;i<n;i++){
        var a=Math.random()*Math.PI*2, e=(Math.random()-0.2)*1.2, sp=(2+Math.random()*5)*power;
        ps.emit({ x:x, y:y, z:z, vx:Math.cos(a)*Math.cos(e)*sp, vy:Math.sin(e)*sp+1.5, vz:Math.sin(a)*Math.cos(e)*sp,
          life:0.35+Math.random()*0.5, size:0.07+Math.random()*0.06, sizeEnd:0.01, grav:9, drag:1.2,
          color:[3.2,2.2,0.9,1] });
      }
    },
    dust: function(ps, x, y, z, n, spread){
      spread=spread||1;
      for(var i=0;i<n;i++){
        var a=Math.random()*Math.PI*2, sp=0.4+Math.random()*1.4;
        ps.emit({ x:x+(Math.random()-0.5)*spread, y:y+0.05, z:z+(Math.random()-0.5)*spread,
          vx:Math.cos(a)*sp, vy:0.3+Math.random()*0.6, vz:Math.sin(a)*sp,
          life:0.9+Math.random()*0.9, size:0.25+Math.random()*0.25, sizeEnd:0.9+Math.random()*0.5, drag:2.2, grav:-0.1,
          color:[0.62,0.52,0.5,0.32] });
      }
    },
    embers: function(ps, x, y, z, n, radius){
      for(var i=0;i<n;i++){
        ps.emit({ x:x+(Math.random()-0.5)*radius, y:y+Math.random()*0.3, z:z+(Math.random()-0.5)*radius,
          vx:(Math.random()-0.5)*0.3, vy:0.5+Math.random()*0.9, vz:(Math.random()-0.5)*0.3,
          life:1.2+Math.random()*1.5, size:0.05+Math.random()*0.04, sizeEnd:0.01, flutter:0.8,
          color:[2.4,1.1,0.35,1] });
      }
    },
    confetti: function(ps, x, y, z, n, spread){
      if(window.MK && MK.reduceMotion) n=Math.ceil(n/4);
      var cols=[[1,0.35,0.3],[1,0.85,0.35],[1,1,1],[0.4,0.75,1],[1,0.55,0.8],[0.5,0.95,0.55]];
      for(var i=0;i<n;i++){
        var c=cols[i%cols.length];
        ps.emit({ x:x+(Math.random()-0.5)*spread, y:y+Math.random()*1.5, z:z+(Math.random()-0.5)*spread,
          vx:(Math.random()-0.5)*2, vy:1+Math.random()*2.5, vz:(Math.random()-0.5)*2,
          life:2.6+Math.random()*2, size:0.07, sizeEnd:0.07, grav:1.6, drag:1.6, flutter:3, spin:(Math.random()-0.5)*14,
          color:[c[0]*1.2,c[1]*1.2,c[2]*1.2,1] });
      }
    },
    firework: function(ps, x, y, z, hue){
      var col=new T.Color().setHSL(hue===undefined?Math.random():hue, 0.9, 0.6);
      var n=70;
      for(var i=0;i<n;i++){
        var u=Math.random()*2-1, a=Math.random()*Math.PI*2, r=Math.sqrt(1-u*u), sp=3.2+Math.random()*0.6;
        ps.emit({ x:x, y:y, z:z, vx:r*Math.cos(a)*sp, vy:u*sp, vz:r*Math.sin(a)*sp,
          life:1.3+Math.random()*0.6, size:0.22, sizeEnd:0.05, grav:1.2, drag:1.4,
          color:[col.r*4, col.g*4, col.b*4, 1] });
      }
      ps.emit({ x:x, y:y, z:z, life:0.25, size:2.2, sizeEnd:0.4, color:[col.r*3,col.g*3,col.b*3,1] });
    },
    petals: function(ps, x, y, z, n, radius, color){
      color=color||[1,0.72,0.84];
      for(var i=0;i<n;i++){
        ps.emit({ x:x+(Math.random()-0.5)*radius, y:y+Math.random()*1.2, z:z+(Math.random()-0.5)*radius,
          vx:(Math.random()-0.5)*0.4, vy:-0.2-Math.random()*0.3, vz:(Math.random()-0.5)*0.4,
          life:2+Math.random()*1.5, size:0.07, sizeEnd:0.06, flutter:2.2, spin:(Math.random()-0.5)*6,
          color:[color[0],color[1],color[2],0.95] });
      }
    },
    ring: function(ps, x, y, z, radius, color, n){
      n=n||40;
      for(var i=0;i<n;i++){
        var a=i/n*Math.PI*2;
        ps.emit({ x:x+Math.cos(a)*radius*0.3, y:y, z:z+Math.sin(a)*radius*0.3,
          vx:Math.cos(a)*radius*2.4, vy:0.3, vz:Math.sin(a)*radius*2.4,
          life:0.55, size:0.18, sizeEnd:0.02, drag:3.5, color:color||[3,2.2,1,1] });
      }
    }
  };

  /* ================= 描画パイプライン ================= */
  var R = null, post = null;
  G.quality = 'high';
  G.init = function(canvasEl){
    if(R) return true;
    if(!G.available() || G.failed) return false;
    try{
      R = new T.WebGLRenderer({ canvas:canvasEl, antialias:true, alpha:false, powerPreference:'high-performance' });
    }catch(e){ R=null; G.failed=true; return false; }
    if(!R.getContext || !R.getContext()){ R=null; G.failed=true; return false; }
    G.renderer = R;
    G.maxAniso = Math.min(4, R.capabilities.getMaxAnisotropy ? R.capabilities.getMaxAnisotropy() : 1);
    var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'');
    G.isMobile = isMobile;
    G.pixelRatio = Math.min(window.devicePixelRatio||1, isMobile?1.6:2);
    R.setPixelRatio(G.pixelRatio);
    R.shadowMap.enabled = true;
    R.shadowMap.type = T.PCFSoftShadowMap;
    R.setClearColor(0x120e1c, 1);
    /* WebGL2 と半精度浮動小数の描画先が使えるなら、光のにじみ付きの高品質経路 */
    var gl = R.getContext();
    var canHDR = R.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
    var forceLow = /[?&]lowfx=1/.test(location.search||'');
    if(canHDR && T.WebGLMultisampleRenderTarget && !forceLow){
      try{ post = makePost(); }catch(e){ post=null; }
    }
    if(post){
      R.toneMapping = T.NoToneMapping;
      R.outputEncoding = T.LinearEncoding;
      G.quality='high';
    } else {
      R.toneMapping = T.ACESFilmicToneMapping;
      R.toneMappingExposure = 1.05;
      R.outputEncoding = T.sRGBEncoding;
      G.quality='basic';
    }
    try{
      var pm = new T.PMREMGenerator(R);
      var ec = envCanvas();
      if(ec){
        var et = toTex(ec, true, false); et.mapping=T.EquirectangularReflectionMapping;
        G.envMap = pm.fromEquirectangular(et).texture;
        et.dispose();
      }
      pm.dispose();
    }catch(e){ G.envMap=null; }
    G.resize();
    window.addEventListener('resize', G.resize);
    return true;
  };
  G.ready = function(){ return !!R; };
  G.size = { w:1, h:1 };
  G.resize = function(){
    if(!R) return;
    var c=R.domElement;
    var w=c.clientWidth||window.innerWidth||1, h=c.clientHeight||window.innerHeight||1;
    G.size.w=w; G.size.h=h;
    R.setSize(w,h,false);
    if(post) post.setSize(w*G.pixelRatio, h*G.pixelRatio);
    G.pointScale = h*G.pixelRatio*0.5/Math.tan(50*Math.PI/360);
    G._particleSets.forEach(function(p){ p.mat.uniforms.uScale.value=G.pointScale; });
  };
  G.fxState = { exposure:1.08, bloom:0.55, vignette:0.5, grain:0.025, flash:0, fade:0, impact:0, saturation:1.1 };
  /* 端末が重い時は自動で画質を落とす（90コマの平均が22msを超えたら1段階）。
   * 1段目: 解像度を1.25倍まで・ふちのなめらか処理を半分 / 2段目: 解像度1倍・なめらか処理なし。
   * 起動直後の約2秒は素材の準備で一時的に重いので数えない。1コマの引っかかりは34msで頭打ちにして数える */
  var perf={ n:0, sum:0, level:0, warm:2.0 };   /* warm は秒（コマ数だと遅い端末ほど待ちが延びる） */
  G.adapt = function(realDt){
    if(!R || perf.level>=2) return;
    if(perf.warm>0){ perf.warm-=realDt; return; }
    perf.n++; perf.sum+=Math.min(realDt, 0.034);
    if(perf.n<90) return;
    var avg=perf.sum/perf.n*1000; perf.n=0; perf.sum=0;
    if(avg>22){
      perf.level++;
      G.pixelRatio=perf.level===1?Math.min(G.pixelRatio,1.25):1;
      R.setPixelRatio(G.pixelRatio);
      if(post && post.setSamples) post.setSamples(perf.level===1?2:0);
      G.resize();
      perf.warm=0.5;
    }
  };
  G.perfLevel = function(){ return perf.level; };
  G.render = function(scene, camera){
    if(!R) return;
    if(camera.aspect!==G.size.w/G.size.h){ camera.aspect=G.size.w/G.size.h; camera.updateProjectionMatrix(); }
    if(post) post.render(scene, camera);
    else R.render(scene, camera);
  };
  G.fullscreenFade = function(){};

  function makePost(){
    var rtOpts={ minFilter:T.LinearFilter, magFilter:T.LinearFilter, format:T.RGBAFormat, type:T.HalfFloatType };
    var rtScene=new T.WebGLMultisampleRenderTarget(1,1,rtOpts); rtScene.samples=4;
    var rtBright=new T.WebGLRenderTarget(1,1,rtOpts);
    var rtA=new T.WebGLRenderTarget(1,1,rtOpts), rtB=new T.WebGLRenderTarget(1,1,rtOpts);
    var rtA2=new T.WebGLRenderTarget(1,1,rtOpts), rtB2=new T.WebGLRenderTarget(1,1,rtOpts);
    var quadCam=new T.OrthographicCamera(-1,1,1,-1,0,1);
    var quad=new T.Mesh(new T.PlaneBufferGeometry?new T.PlaneBufferGeometry(2,2):new T.PlaneGeometry(2,2), null);
    var qScene=new T.Scene(); qScene.add(quad);
    var VS='varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }';
    var brightMat=new T.ShaderMaterial({
      uniforms:{ tex:{value:null}, threshold:{value:1.4}, knee:{value:0.45} },
      vertexShader:VS,
      fragmentShader:[
        'uniform sampler2D tex; uniform float threshold; uniform float knee; varying vec2 vUv;',
        'void main(){ vec3 c=texture2D(tex,vUv).rgb; float l=max(c.r,max(c.g,c.b));',
        '  float soft=clamp(l-threshold+knee,0.0,2.0*knee); soft=soft*soft/(4.0*knee+1e-4);',
        '  float w=max(soft,l-threshold)/max(l,1e-4); gl_FragColor=vec4(c*w,1.0); }'
      ].join('\n'), depthTest:false, depthWrite:false
    });
    var blurMat=new T.ShaderMaterial({
      uniforms:{ tex:{value:null}, dir:{value:new T.Vector2(1,0)} },
      vertexShader:VS,
      fragmentShader:[
        'uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;',
        'void main(){ vec3 c=texture2D(tex,vUv).rgb*0.227;',
        '  c+=texture2D(tex,vUv+dir*1.384).rgb*0.316; c+=texture2D(tex,vUv-dir*1.384).rgb*0.316;',
        '  c+=texture2D(tex,vUv+dir*3.230).rgb*0.070; c+=texture2D(tex,vUv-dir*3.230).rgb*0.070;',
        '  gl_FragColor=vec4(c,1.0); }'
      ].join('\n'), depthTest:false, depthWrite:false
    });
    var compMat=new T.ShaderMaterial({
      uniforms:{ tScene:{value:null}, tBloom:{value:null}, tBloom2:{value:null}, exposure:{value:1}, bloom:{value:0.9},
        vignette:{value:0.55}, grain:{value:0.035}, time:{value:0}, flash:{value:0}, fade:{value:0},
        impact:{value:0}, saturation:{value:1.08}, res:{value:new T.Vector2(1,1)} },
      vertexShader:VS,
      fragmentShader:[
        'uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBloom2;',
        'uniform float exposure, bloom, vignette, grain, time, flash, fade, impact, saturation; uniform vec2 res; varying vec2 vUv;',
        'vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }',
        'float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }',
        'void main(){',
        '  vec2 uv=vUv; vec2 dc=uv-0.5;',
        '  vec3 c;',
        '  if(impact>0.001){ float k=impact*0.012; c.r=texture2D(tScene,uv+dc*k).r; c.g=texture2D(tScene,uv).g; c.b=texture2D(tScene,uv-dc*k).b; }',
        '  else c=texture2D(tScene,uv).rgb;',
        '  vec3 b=texture2D(tBloom,uv).rgb*0.6+texture2D(tBloom2,uv).rgb*0.8;',
        '  c=c*exposure+b*bloom;',
        '  c=aces(c*1.05);',
        '  float l=dot(c,vec3(0.299,0.587,0.114));',
        '  c=mix(c, c*vec3(0.9,0.97,1.12), (1.0-l)*0.35);',  /* 影を青紫へ */
        '  c=mix(c, c*vec3(1.07,1.0,0.88), l*0.3);',          /* 明部を暖色へ */
        '  c=mix(vec3(l),c,saturation);',
        '  float v=smoothstep(0.85,0.25,length(dc*vec2(1.0,1.15)));',
        '  c*=mix(1.0,v,vignette);',
        '  c=pow(max(c,0.0),vec3(1.0/2.2));',
        '  c+=(hash(uv*res+time)-0.5)*grain;',
        '  c=mix(c,vec3(1.0,0.96,0.88),flash); c=mix(c,vec3(0.0),fade);',
        '  gl_FragColor=vec4(c,1.0); }'
      ].join('\n'), depthTest:false, depthWrite:false
    });
    var W=1, H=1;
    function pass(mat, target){ quad.material=mat; R.setRenderTarget(target); R.render(qScene, quadCam); }
    return {
      /* ふちのなめらか処理（MSAA）の回数を変える。描画先を作り直す */
      setSamples:function(n){ if(rtScene.samples!==n){ rtScene.samples=n; rtScene.dispose(); } },
      setSize:function(w,h){
        W=Math.max(1,Math.floor(w)); H=Math.max(1,Math.floor(h));
        rtScene.setSize(W,H);
        rtBright.setSize(Math.max(1,W>>1),Math.max(1,H>>1));
        rtA.setSize(Math.max(1,W>>2),Math.max(1,H>>2)); rtB.setSize(Math.max(1,W>>2),Math.max(1,H>>2));
        rtA2.setSize(Math.max(1,W>>3),Math.max(1,H>>3)); rtB2.setSize(Math.max(1,W>>3),Math.max(1,H>>3));
        compMat.uniforms.res.value.set(W,H);
      },
      render:function(scene, camera){
        var f=G.fxState;
        R.setRenderTarget(rtScene); R.clear(); R.render(scene, camera);
        brightMat.uniforms.tex.value=rtScene.texture; pass(brightMat, rtBright);
        /* 近いにじみ（1/4） */
        blurMat.uniforms.tex.value=rtBright.texture; blurMat.uniforms.dir.value.set(1/(W>>2||1),0); pass(blurMat, rtA);
        blurMat.uniforms.tex.value=rtA.texture; blurMat.uniforms.dir.value.set(0,1/(H>>2||1)); pass(blurMat, rtB);
        /* 遠いにじみ（1/8） */
        blurMat.uniforms.tex.value=rtB.texture; blurMat.uniforms.dir.value.set(1.5/(W>>3||1),0); pass(blurMat, rtA2);
        blurMat.uniforms.tex.value=rtA2.texture; blurMat.uniforms.dir.value.set(0,1.5/(H>>3||1)); pass(blurMat, rtB2);
        var u=compMat.uniforms;
        u.tScene.value=rtScene.texture; u.tBloom.value=rtB.texture; u.tBloom2.value=rtB2.texture;
        u.exposure.value=f.exposure; u.bloom.value=f.bloom; u.vignette.value=f.vignette; u.grain.value=f.grain;
        u.time.value=(performance.now()%10000)/1000; u.flash.value=f.flash; u.fade.value=f.fade;
        u.impact.value=f.impact; u.saturation.value=f.saturation;
        pass(compMat, null);
      }
    };
  }

  /* 画面の揺れ・閃光などの演出値を時間で戻す */
  G.updateFx = function(dt){
    var f=G.fxState;
    f.flash=Math.max(0, f.flash-dt*2.8);
    f.impact=Math.max(0, f.impact-dt*2.2);
    if(window.MK && MK.reduceMotion){ f.flash=Math.min(f.flash,0.1); f.impact=0; }
  };
  G.updateParticles = function(dt){ G._particleSets.forEach(function(p){ p.update(dt); }); };
  /* 地面に落ちる丸い影（担ぎ手や小物用。影計算より軽い） */
  G.blobShadowMat = function(){
    return mcached('blob', function(){
      var S=64, c=canvas(S,S), cx=ctx2d(c);
      if(cx){ var g=cx.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2); g.addColorStop(0,'rgba(0,0,0,0.55)'); g.addColorStop(1,'rgba(0,0,0,0)'); cx.fillStyle=g; cx.fillRect(0,0,S,S); }
      return new T.MeshBasicMaterial({ map:toTex(c,false,false), transparent:true, depthWrite:false });
    });
  };
  /* 光のにじみ用のスプライト（提灯など） */
  G.glowSprite = function(hex, size, intensity){
    var m=new T.SpriteMaterial({ map:G.tex.glow(), color:new T.Color(hex).multiplyScalar(intensity||1.5), transparent:true, depthWrite:false, blending:T.AdditiveBlending });
    var s=new T.Sprite(m); s.scale.set(size,size,size);
    return s;
  };
  /* シーンの空と映り込みを整える */
  G.setupScene = function(scene){
    if(G.envMap) scene.environment = G.envMap;
    return scene;
  };
})();
