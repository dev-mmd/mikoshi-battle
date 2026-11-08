/* せーの！神輿バトル v2 — 担ぎ手アバター
 * ・骨格20本の人形（頭・首・胸・腰・腕・脚が関節で動く）。部品ごとに1本の骨へ固定（剛体スキン）
 * ・1人＝1メッシュ＝1回の描画。色は頂点色、柄・顔・背紋は1枚の「衣装シート」テクスチャに描く
 * ・衣装: 法被（柄・背紋・襟文字）/ 腹掛け / 帯 / 股引 / 地下足袋 / ねじり鉢巻
 * ・表情: 普段／掛け声／喜び／悔しいの4つを切り替える（頭の貼り付け位置を差し替え）
 * ・身長は約0.86（神輿の担ぎ棒の下端＝肩の高さ 0.61 に合わせたデフォルメ体型） */
(function(){
  'use strict';
  var MK = window.MK = window.MK || {};
  var G = MK.gfx, U = MK.util, C = MK.C;
  var T = window.THREE;

  /* ---------- 骨格（休みの姿勢＝気をつけ。座標は地面基準） ---------- */
  var BONES = [
    ['root',  null,   0,    0,     0],
    ['hips',  'root', 0,    0.34,  0],
    ['spine', 'hips', 0,    0.40,  0],
    ['chest', 'spine',0,    0.48,  0],
    ['neck',  'chest',0,    0.575, 0],
    ['head',  'neck', 0,    0.60,  0],
    ['shL',   'chest',0.07, 0.54,  0],
    ['uaL',   'shL',  0.145,0.545, 0],
    ['faL',   'uaL',  0.15, 0.42,  0],
    ['hL',    'faL',  0.152,0.30,  0],
    ['shR',   'chest',-0.07,0.54,  0],
    ['uaR',   'shR',  -0.145,0.545,0],
    ['faR',   'uaR',  -0.15,0.42,  0],
    ['hR',    'faR',  -0.152,0.30, 0],
    ['thL',   'hips', 0.062,0.32,  0],
    ['kneeL', 'thL',  0.062,0.185, 0],
    ['ftL',   'kneeL',0.062,0.055, 0],
    ['thR',   'hips', -0.062,0.32, 0],
    ['kneeR', 'thR',  -0.062,0.185,0],
    ['ftR',   'kneeR',-0.062,0.055,0]
  ];
  var BI = {}; BONES.forEach(function(b,i){ BI[b[0]]=i; });
  var HEAD_C = 0.715, HEAD_R = 0.125;

  /* ---------- 衣装シート（512 or 1024 四方） ----------
   * 左上 256x256: 顔4面（普段A/掛け声A/普段B/掛け声B）…各128x128の正距円筒
   * 左下の上半分: 喜び・悔しいの顔（顔立ちA/B共通）　左下の下半分: 無地（頂点色だけで塗る部品）
   * 右上: 法被の柄＋背紋＋襟　右下: 鉢巻のねじり縞・帯 */
  var REG = {
    faceA:{x:0,y:0,w:0.25,h:0.25}, shoutA:{x:0.25,y:0,w:0.25,h:0.25},
    faceB:{x:0,y:0.25,w:0.25,h:0.25}, shoutB:{x:0.25,y:0.25,w:0.25,h:0.25},
    joy:{x:0,y:0.5,w:0.25,h:0.25}, sad:{x:0.25,y:0.5,w:0.25,h:0.25},
    happi:{x:0.5,y:0,w:0.5,h:0.5}, plain:{x:0.05,y:0.8,w:0.4,h:0.15},
    band:{x:0.5,y:0.5,w:0.5,h:0.25}, obi:{x:0.5,y:0.75,w:0.5,h:0.25}
  };
  var SHEETS = {};
  function patternDraw(cx, x0, y0, w, h, kind, base){
    cx.save(); cx.beginPath(); cx.rect(x0,y0,w,h); cx.clip();
    cx.fillStyle=base; cx.fillRect(x0,y0,w,h);
    var lighter='rgba(255,255,255,0.16)', darker='rgba(0,0,0,0.18)';
    if(kind==='asanoha'){ /* 麻の葉 */
      var s=w/8; cx.strokeStyle=lighter; cx.lineWidth=Math.max(1,w/256);
      for(var yy=0;yy<=h/s*1.2;yy++) for(var xx=0;xx<=8;xx++){
        var cx0=x0+xx*s+(yy%2)*s/2, cy0=y0+yy*s*0.866;
        for(var k=0;k<6;k++){ var a=k*Math.PI/3; cx.beginPath(); cx.moveTo(cx0,cy0); cx.lineTo(cx0+Math.cos(a)*s*0.5, cy0+Math.sin(a)*s*0.5); cx.stroke(); }
        cx.beginPath(); for(k=0;k<=6;k++){ var b=k*Math.PI/3+Math.PI/6; var px=cx0+Math.cos(b)*s*0.58, py=cy0+Math.sin(b)*s*0.58; if(k===0) cx.moveTo(px,py); else cx.lineTo(px,py); } cx.stroke();
      }
    } else if(kind==='shima'){ /* 縞 */
      for(var i=0;i<16;i++){ cx.fillStyle=i%2?lighter:darker; cx.fillRect(x0+i*w/16, y0, w/32, h); }
    } else if(kind==='kikko'){ /* 亀甲 */
      var r=w/10; cx.strokeStyle=lighter; cx.lineWidth=Math.max(1,w/200);
      for(var gy=0;gy<h/(r*1.5)+1;gy++) for(var gx=0;gx<w/(r*1.732)+1;gx++){
        var hx=x0+gx*r*1.732+(gy%2)*r*0.866, hy=y0+gy*r*1.5;
        cx.beginPath(); for(var q=0;q<=6;q++){ var an=q*Math.PI/3+Math.PI/6; var qx=hx+Math.cos(an)*r, qy=hy+Math.sin(an)*r; if(q===0) cx.moveTo(qx,qy); else cx.lineTo(qx,qy); } cx.stroke();
      }
    } else { /* 波（青海波） */
      var rr=w/12; cx.strokeStyle=lighter; cx.lineWidth=Math.max(1,w/220);
      for(var ry=0;ry<h/(rr*0.5)+2;ry++) for(var rx=0;rx<w/(rr*2)+2;rx++){
        var ox=x0+rx*rr*2+(ry%2)*rr, oy=y0+ry*rr*0.5;
        for(var ring=1;ring<=3;ring++){ cx.beginPath(); cx.arc(ox,oy,rr*ring/3,Math.PI,Math.PI*2); cx.stroke(); }
      }
    }
    cx.restore();
  }
  function faceDraw(cx, x0, y0, S, style, shout){
    /* 肌は白っぽく描き、頂点色で肌色を掛ける */
    cx.fillStyle='#fff4ea'; cx.fillRect(x0,y0,S,S);
    var fx=x0+S*0.25, yEye=y0+S*0.55, dx=S*0.078;
    /* 頬の赤み */
    [-1,1].forEach(function(s){
      var g=cx.createRadialGradient(fx+s*dx*1.35, y0+S*0.64, 0, fx+s*dx*1.35, y0+S*0.64, S*0.045);
      g.addColorStop(0,'rgba(255,120,110,0.55)'); g.addColorStop(1,'rgba(255,120,110,0)');
      cx.fillStyle=g; cx.fillRect(fx+s*dx*1.35-S*0.05, y0+S*0.59, S*0.1, S*0.1);
    });
    cx.lineCap='round';
    /* 眉 */
    cx.strokeStyle='#2a1c16'; cx.lineWidth=S*(style?0.012:0.017);
    [-1,1].forEach(function(s){
      var ang=shout?0.35:(style?0.08:0.2);
      cx.beginPath();
      cx.moveTo(fx+s*dx*0.55, y0+S*(0.49)+(shout?S*0.012:0));
      cx.lineTo(fx+s*dx*1.35, y0+S*0.49-s*0*ang*S*0.04 - ang*S*0.04);
      cx.stroke();
    });
    /* 目 */
    [-1,1].forEach(function(s){
      var ex=fx+s*dx;
      if(shout){
        cx.strokeStyle='#1d1412'; cx.lineWidth=S*0.014;
        cx.beginPath(); cx.moveTo(ex-S*0.024, yEye-S*0.012); cx.lineTo(ex+s*S*0.004, yEye+S*0.004); cx.lineTo(ex+S*0.024, yEye-S*0.012); cx.stroke();
      } else {
        var ew=S*(style?0.029:0.026), eh=S*(style?0.052:0.044);
        cx.fillStyle='#231612'; cx.beginPath(); cx.ellipse(ex, yEye, ew, eh, 0, 0, Math.PI*2); cx.fill();
        var ig=cx.createLinearGradient(0,yEye-eh,0,yEye+eh); ig.addColorStop(0,'#3a2620'); ig.addColorStop(1,style?'#7a4a2a':'#5a3a52');
        cx.fillStyle=ig; cx.beginPath(); cx.ellipse(ex, yEye+eh*0.2, ew*0.72, eh*0.66, 0, 0, Math.PI*2); cx.fill();
        cx.fillStyle='#ffffff'; cx.beginPath(); cx.arc(ex-ew*0.3, yEye-eh*0.35, ew*0.34, 0, Math.PI*2); cx.fill();
        cx.beginPath(); cx.arc(ex+ew*0.3, yEye+eh*0.35, ew*0.16, 0, Math.PI*2); cx.fill();
        /* まつ毛の線 */
        cx.strokeStyle='#1a100c'; cx.lineWidth=S*0.008;
        cx.beginPath(); cx.moveTo(ex-ew*1.25, yEye-eh*0.8); cx.quadraticCurveTo(ex, yEye-eh*1.25, ex+ew*1.25, yEye-eh*0.8); cx.stroke();
      }
    });
    /* 口 */
    if(shout){
      cx.fillStyle='#6a1a14'; cx.beginPath(); cx.ellipse(fx, y0+S*0.675, S*0.028, S*0.032, 0, 0, Math.PI*2); cx.fill();
      cx.fillStyle='#ff8a80'; cx.beginPath(); cx.ellipse(fx, y0+S*0.688, S*0.018, S*0.012, 0, 0, Math.PI*2); cx.fill();
      cx.fillStyle='#fff'; cx.fillRect(fx-S*0.02, y0+S*0.645, S*0.04, S*0.008);
    } else {
      cx.strokeStyle='#5a2a20'; cx.lineWidth=S*0.011;
      cx.beginPath(); cx.arc(fx, y0+S*0.645, S*0.018, 0.25, Math.PI-0.25); cx.stroke();
    }
  }
  /* 喜び（目を細めて大きく笑う）・悔しい（目をぎゅっと閉じ、眉を寄せ、歯を食いしばって涙） */
  function moodFaceDraw(cx, x0, y0, S, mood){
    cx.fillStyle='#fff4ea'; cx.fillRect(x0,y0,S,S);
    var fx=x0+S*0.25, yEye=y0+S*0.55, dx=S*0.078;
    [-1,1].forEach(function(s){
      var g=cx.createRadialGradient(fx+s*dx*1.35, y0+S*0.64, 0, fx+s*dx*1.35, y0+S*0.64, S*0.05);
      g.addColorStop(0,mood==='joy'?'rgba(255,110,100,0.7)':'rgba(255,120,110,0.45)'); g.addColorStop(1,'rgba(255,120,110,0)');
      cx.fillStyle=g; cx.fillRect(fx+s*dx*1.35-S*0.055, y0+S*0.585, S*0.11, S*0.11);
    });
    cx.lineCap='round'; cx.lineJoin='round';
    [-1,1].forEach(function(s){
      var ex=fx+s*dx;
      cx.strokeStyle='#2a1c16'; cx.lineWidth=S*0.014;
      cx.beginPath();
      if(mood==='joy'){ /* 上がった眉 */
        cx.moveTo(fx+s*dx*0.5, y0+S*0.475); cx.quadraticCurveTo(fx+s*dx, y0+S*0.455, fx+s*dx*1.45, y0+S*0.47);
      } else { /* 内側が上がった困り眉 */
        cx.moveTo(fx+s*dx*0.45, y0+S*0.46); cx.lineTo(fx+s*dx*1.4, y0+S*0.5);
      }
      cx.stroke();
      cx.strokeStyle='#1d1412'; cx.lineWidth=S*0.015;
      cx.beginPath();
      if(mood==='joy'){ /* にっこり目（∩） */
        cx.moveTo(ex-S*0.026, yEye+S*0.008); cx.quadraticCurveTo(ex, yEye-S*0.03, ex+S*0.026, yEye+S*0.008);
      } else { /* ぎゅっと閉じた目（＞＜） */
        cx.moveTo(ex+s*S*0.026, yEye-S*0.018); cx.lineTo(ex-s*S*0.016, yEye); cx.lineTo(ex+s*S*0.026, yEye+S*0.016);
      }
      cx.stroke();
    });
    if(mood==='joy'){ /* 大きく開けた笑い口 */
      cx.fillStyle='#6a1a14'; cx.beginPath();
      cx.moveTo(fx-S*0.036, y0+S*0.64); cx.quadraticCurveTo(fx, y0+S*0.645, fx+S*0.036, y0+S*0.64);
      cx.quadraticCurveTo(fx+S*0.03, y0+S*0.7, fx, y0+S*0.705); cx.quadraticCurveTo(fx-S*0.03, y0+S*0.7, fx-S*0.036, y0+S*0.64); cx.fill();
      cx.fillStyle='#ff8a80'; cx.beginPath(); cx.ellipse(fx, y0+S*0.69, S*0.018, S*0.01, 0, 0, Math.PI*2); cx.fill();
      cx.fillStyle='#fff'; cx.fillRect(fx-S*0.03, y0+S*0.643, S*0.06, S*0.009);
    } else { /* 食いしばった歯＋涙 */
      cx.fillStyle='#fff'; cx.strokeStyle='#5a2a20'; cx.lineWidth=S*0.008;
      cx.beginPath(); cx.rect(fx-S*0.03, y0+S*0.655, S*0.06, S*0.022); cx.fill(); cx.stroke();
      cx.beginPath(); cx.moveTo(fx-S*0.03, y0+S*0.666); cx.lineTo(fx+S*0.03, y0+S*0.666); cx.stroke();
      cx.fillStyle='rgba(120,190,255,0.9)';
      [-1,1].forEach(function(s){ var tx=fx+s*dx*1.15, ty=y0+S*0.585;
        cx.beginPath(); cx.moveTo(tx, ty); cx.quadraticCurveTo(tx+S*0.012, ty+S*0.03, tx, ty+S*0.034); cx.quadraticCurveTo(tx-S*0.012, ty+S*0.03, tx, ty); cx.fill(); });
    }
  }
  /* 衣装シートを作る（同じ衣装はキャッシュして共有） */
  function sheet(outfit, size){
    size=size||512;
    var key=[outfit.happi, outfit.pattern, outfit.crest, outfit.collar, outfit.band, outfit.obi, size].join('|');
    if(SHEETS[key]) return SHEETS[key];
    var c=G.canvas(size,size), cx=c.getContext && c.getContext('2d');
    if(cx){
      var S=size;
      cx.fillStyle='#ffffff'; cx.fillRect(0,0,S,S);
      faceDraw(cx, 0, 0, S*0.25, 0, false); faceDraw(cx, S*0.25, 0, S*0.25, 0, true);
      faceDraw(cx, 0, S*0.25, S*0.25, 1, false); faceDraw(cx, S*0.25, S*0.25, S*0.25, 1, true);
      moodFaceDraw(cx, 0, S*0.5, S*0.25, 'joy'); moodFaceDraw(cx, S*0.25, S*0.5, S*0.25, 'sad');
      /* 法被: 地の色＋柄。u=0.5 が背中の中心 */
      var hx=S*0.5, hy=0, hw=S*0.5, hh=S*0.5;
      patternDraw(cx, hx, hy, hw, hh, outfit.pattern, U.hex(outfit.happi));
      /* 裾の太い帯（腰柄） */
      cx.fillStyle='rgba(255,255,255,0.9)'; cx.fillRect(hx, hy+hh*0.86, hw, hh*0.035);
      cx.fillStyle=U.hex(outfit.collar); cx.fillRect(hx, hy+hh*0.9, hw, hh*0.1);
      /* 背紋: 丸に文字 */
      var bx=hx+hw*0.5, by=hy+hh*0.36, br=hw*0.12;
      cx.fillStyle='#fdf7ea'; cx.beginPath(); cx.arc(bx,by,br,0,Math.PI*2); cx.fill();
      cx.strokeStyle=U.hex(outfit.collar); cx.lineWidth=br*0.14; cx.beginPath(); cx.arc(bx,by,br*0.86,0,Math.PI*2); cx.stroke();
      cx.fillStyle=U.hex(outfit.collar); cx.font='bold '+Math.round(br*1.25)+'px "Hiragino Mincho ProN","Yu Mincho",serif';
      cx.textAlign='center'; cx.textBaseline='middle'; cx.fillText(outfit.crest||'祭', bx, by+br*0.05);
      /* 襟（前の合わせ）: u=0 と u=1 の端 */
      cx.fillStyle=U.hex(outfit.collar); cx.fillRect(hx, hy, hw*0.07, hh); cx.fillRect(hx+hw*0.93, hy, hw*0.07, hh);
      /* 鉢巻のねじり縞 */
      var bdx=S*0.5, bdy=S*0.5, bdw=S*0.5, bdh=S*0.25;
      cx.fillStyle=U.hex(outfit.band); cx.fillRect(bdx,bdy,bdw,bdh);
      cx.strokeStyle='rgba(0,0,0,0.22)'; cx.lineWidth=bdw/40;
      for(var i=-4;i<44;i++){ cx.beginPath(); cx.moveTo(bdx+i*bdw/40, bdy); cx.lineTo(bdx+i*bdw/40+bdh*0.5, bdy+bdh); cx.stroke(); }
      /* 帯 */
      cx.fillStyle=U.hex(outfit.obi); cx.fillRect(S*0.5, S*0.75, S*0.5, S*0.25);
      cx.fillStyle='rgba(255,255,255,0.25)'; for(i=0;i<6;i++) cx.fillRect(S*0.5, S*0.75+i*S*0.045, S*0.5, S*0.008);
    }
    var tex=G.toTex(c, true, false);
    SHEETS[key]=G.markShared(tex);
    return tex;
  }

  /* ---------- 部品 → 1つのスキンメッシュへ ---------- */
  function Builder(){ this.parts=[]; }
  /* geo: 休みの姿勢の位置に置いた形状 / bone: 骨の名前 / color: 頂点色 / region: 衣装シートの貼り付け先 */
  Builder.prototype.add=function(geo, bone, color, region, tag){
    this.parts.push({ geo:geo, bone:BI[bone], color:new T.Color(color===undefined?0xffffff:color), region:region||REG.plain, tag:tag });
    return geo;
  };
  Builder.prototype.build=function(){
    var vN=0, iN=0;
    this.parts.forEach(function(p){ var g=p.geo; vN+=g.attributes.position.count; iN+=g.index?g.index.count:g.attributes.position.count; });
    var pos=new Float32Array(vN*3), nor=new Float32Array(vN*3), uv=new Float32Array(vN*2), col=new Float32Array(vN*3);
    var si=new Uint16Array(vN*4), sw=new Float32Array(vN*4), idx=vN>65535?new Uint32Array(iN):new Uint16Array(iN);
    var vo=0, io=0, tags={};
    this.parts.forEach(function(p){
      var g=p.geo, P=g.attributes.position, N=g.attributes.normal, UV=g.attributes.uv, n=P.count, r=p.region;
      for(var i=0;i<n;i++){
        var k=vo+i;
        pos[k*3]=P.getX(i); pos[k*3+1]=P.getY(i); pos[k*3+2]=P.getZ(i);
        nor[k*3]=N.getX(i); nor[k*3+1]=N.getY(i); nor[k*3+2]=N.getZ(i);
        var u=UV?UV.getX(i):0.5, v=UV?UV.getY(i):0.5;
        uv[k*2]=r.x+u*r.w; uv[k*2+1]=1-(r.y+(1-v)*r.h);
        col[k*3]=p.color.r; col[k*3+1]=p.color.g; col[k*3+2]=p.color.b;
        si[k*4]=p.bone; sw[k*4]=1;
      }
      if(g.index){ for(var q=0;q<g.index.count;q++) idx[io+q]=g.index.getX(q)+vo; io+=g.index.count; }
      else { for(q=0;q<n;q++) idx[io+q]=vo+q; io+=n; }
      if(p.tag){ (tags[p.tag]=tags[p.tag]||[]).push({ start:vo, count:n, geo:g }); }
      vo+=n;
    });
    var geo=new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos,3));
    geo.setAttribute('normal', new T.BufferAttribute(nor,3));
    geo.setAttribute('uv', new T.BufferAttribute(uv,2));
    geo.setAttribute('color', new T.BufferAttribute(col,3));
    geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(si,4));
    geo.setAttribute('skinWeight', new T.Float32BufferAttribute(sw,4));
    geo.setIndex(new T.BufferAttribute(idx,1));
    geo.computeBoundingSphere();
    geo.boundingSphere.radius=Math.max(geo.boundingSphere.radius, 1.2);
    return { geo:geo, tags:tags };
  };

  /* 形の道具: 2点の間に円柱を渡す */
  function limb(a, b, r1, r2, seg){
    var dir=new T.Vector3().subVectors(b,a), len=dir.length();
    var g=new T.CylinderGeometry(r2, r1, len, seg||10, 1, false);
    var m=new T.Matrix4();
    var q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0), dir.clone().normalize());
    m.compose(new T.Vector3().addVectors(a,b).multiplyScalar(0.5), q, new T.Vector3(1,1,1));
    g.applyMatrix4(m);
    return g;
  }
  function V(x,y,z){ return new T.Vector3(x,y,z); }
  function at(g, x,y,z, sx,sy,sz, rx,ry,rz){
    var m=new T.Matrix4(), e=new T.Euler(rx||0,ry||0,rz||0);
    m.compose(V(x,y,z), new T.Quaternion().setFromEuler(e), V(sx===undefined?1:sx, sy===undefined?(sx===undefined?1:sx):sy, sz===undefined?(sx===undefined?1:sx):sz));
    g.applyMatrix4(m); return g;
  }

  var SKIN = [0xffe0c4, 0xf2c9a0, 0xd9a47a];
  var HAIR = [0x1a1418, 0x2e1f1a, 0x4a2c1c, 0x1c1c2a];

  /* look: { skin, hair, hairStyle(0..2), face(0|1), pants, tabi, build(体格0.95〜1.06) } */
  function build(outfit, look, opts){
    opts=opts||{};
    look=look||{};
    outfit=Object.assign({ happi:0x24478f, pattern:'asanoha', crest:'祭', collar:0x14141e, band:0xf6f1e4, obi:0xf1ead8, pants:0xf2eee4, tabi:0x1d2233 }, outfit||{});
    var B=new Builder();
    var skin=look.skin!==undefined?SKIN[look.skin%SKIN.length]:SKIN[1];
    var hair=look.hair!==undefined?HAIR[look.hair%HAIR.length]:HAIR[0];
    var faceReg=look.face?REG.faceB:REG.faceA, shoutReg=look.face?REG.shoutB:REG.shoutA;

    /* 頭 */
    B.add(at(new T.SphereGeometry(HEAD_R,20,14),0,HEAD_C,0, 1,0.96,0.98), 'head', skin, faceReg, 'face');
    [-1,1].forEach(function(s){ B.add(at(new T.SphereGeometry(0.024,6,5), s*0.121,HEAD_C-0.01,0.0, 0.6,1,1), 'head', skin); });
    /* 髪: 頭頂＋前髪の線（眉の上）＋後頭部 */
    B.add(at(new T.SphereGeometry(0.134,18,7,0,Math.PI*2,0,Math.PI*0.47),0,HEAD_C+0.004,-0.004), 'head', hair);
    B.add(at(new T.SphereGeometry(0.131,14,5,Math.PI*0.5+Math.PI/3,Math.PI*4/3,Math.PI*0.45,Math.PI*0.4),0,HEAD_C,-0.006), 'head', hair);
    /* 前髪の房 */
    for(var bk=-2;bk<=2;bk++){
      var ba=bk*0.28;
      B.add(at(new T.ConeGeometry(0.03,0.07,4),Math.sin(ba)*0.12,HEAD_C+0.035,Math.cos(ba)*0.118, 1,1,0.55, 2.7,ba,0), 'head', hair);
    }
    var hs=look.hairStyle||0;
    if(hs===0){ for(var sp=0;sp<5;sp++){ var sa=-0.9+sp*0.45; B.add(at(new T.ConeGeometry(0.035,0.09,5),Math.sin(sa)*0.07,HEAD_C+0.115,-0.04+Math.cos(sa)*0.02-0.03, 1,1,1, -0.6,0,-sa*0.8), 'head', hair); } }
    else if(hs===1){ B.add(at(new T.SphereGeometry(0.05,12,10),0,HEAD_C+0.1,-0.085), 'head', hair); B.add(at(new T.CylinderGeometry(0.02,0.03,0.06,8),0,HEAD_C+0.13,-0.1, 1,1,1, -0.9,0,0), 'head', hair); }
    else { B.add(limb(V(0,HEAD_C+0.02,-0.12), V(0,HEAD_C-0.17,-0.19), 0.045, 0.018, 9), 'head', hair); B.add(at(new T.SphereGeometry(0.035,10,8),0,HEAD_C+0.02,-0.125), 'head', hair); }
    /* ねじり鉢巻（額に巻いて前で結ぶ） */
    B.add(at(new T.TorusGeometry(0.133,0.019,6,20),0,HEAD_C+0.045,0, 1,1,1, Math.PI/2+0.12,0,0), 'head', 0xffffff, REG.band, 'band');
    B.add(at(new T.SphereGeometry(0.028,7,5),0.05,HEAD_C+0.07,0.118, 1.3,0.9,0.9), 'head', 0xffffff, REG.band, 'band');
    B.add(at(new T.ConeGeometry(0.018,0.07,6),0.085,HEAD_C+0.1,0.1, 1,1,0.6, 0,0,-0.9), 'head', 0xffffff, REG.band, 'band');
    B.add(at(new T.ConeGeometry(0.018,0.06,6),0.02,HEAD_C+0.11,0.115, 1,1,0.6, 0,0,0.6), 'head', 0xffffff, REG.band, 'band');
    /* 首 */
    B.add(limb(V(0,0.56,0), V(0,0.615,0), 0.036, 0.034, 10), 'neck', skin);

    /* 腹掛け（紺の前掛け）＋胴 */
    B.add(limb(V(0,0.30,0.004), V(0,0.565,0.004), 0.108, 0.1, 10), 'chest', 0x1b2440);
    /* 法被: 前が開いた筒（上下2段で胸と腰に固定） */
    var gap=0.24;
    function happiShell(y0, y1, r0, r1, bone, closeTop){
      var pts=[];
      var N=6;
      for(var i=0;i<=N;i++){ var t=i/N; pts.push(new T.Vector2(U.lerp(r0,r1,t)+Math.sin(t*Math.PI)*0.006, U.lerp(y0,y1,t))); }
      if(closeTop){ pts.push(new T.Vector2(r1*0.72, y1+0.018)); pts.push(new T.Vector2(0.05, y1+0.026)); }
      var g=new T.LatheGeometry(pts, 14, gap, Math.PI*2-gap*2);
      /* 貼り付け: 下段は柄の下半分、上段は上半分 */
      var uvA=g.attributes.uv;
      for(var k=0;k<uvA.count;k++){ var vv=uvA.getY(k); uvA.setY(k, closeTop?0.5+vv*0.5:vv*0.5); }
      B.add(g, bone, 0xffffff, REG.happi, 'happi');
      /* 裏地（開いた前から見える内側） */
      var gi=new T.LatheGeometry([pts[0], pts[pts.length-1]].map(function(p){ return new T.Vector2(p.x-0.004,p.y); }).reverse(), 10, gap, Math.PI*2-gap*2);
      B.add(gi, bone, new T.Color(outfit.happi).multiplyScalar(0.45).getHex());
    }
    happiShell(0.215, 0.43, 0.14, 0.13, 'spine', false);
    happiShell(0.43, 0.565, 0.13, 0.145, 'chest', true);
    /* 襟（V字に合わさる前の帯） */
    [-1,1].forEach(function(s){
      B.add(limb(V(s*0.05,0.575,0.075), V(s*0.03,0.41,0.13), 0.011, 0.011, 6), 'chest', outfit.collar);
      B.add(limb(V(s*0.03,0.41,0.13), V(s*0.038,0.22,0.138), 0.01, 0.01, 6), 'spine', outfit.collar);
    });
    /* 帯 */
    B.add(at(new T.CylinderGeometry(0.139,0.141,0.04,14,1,true),0,0.35,0), 'spine', 0xffffff, REG.obi, 'obi');
    B.add(at(new T.BoxGeometry(0.05,0.035,0.03),0.03,0.35,0.14), 'spine', 0xffffff, REG.obi, 'obi');
    /* 腰（股引の上部） */
    B.add(at(new T.SphereGeometry(0.1,10,7),0,0.3,0, 1.25,0.75,1.0), 'hips', outfit.pants);
    /* 脚: 股引＋地下足袋 */
    [['L',1],['R',-1]].forEach(function(e){
      var s=e[1], x=s*0.062;
      B.add(limb(V(x,0.325,0), V(x,0.19,0.004), 0.047, 0.04, 8), 'th'+e[0], outfit.pants);
      B.add(at(new T.SphereGeometry(0.039,8,5),x,0.188,0.004), 'knee'+e[0], outfit.pants);
      B.add(limb(V(x,0.188,0.004), V(x,0.1,0), 0.037, 0.032, 8), 'knee'+e[0], outfit.pants);
      B.add(limb(V(x,0.105,0), V(x,0.04,0.004), 0.034, 0.036, 8), 'knee'+e[0], outfit.tabi);
      B.add(at(new T.SphereGeometry(0.042,8,6),x,0.028,0.028, 0.9,0.62,1.55), 'ft'+e[0], outfit.tabi);
      /* こはぜ（足袋の留め具） */
      B.add(at(new T.BoxGeometry(0.004,0.03,0.012),x+s*0.034,0.07,0.006), 'knee'+e[0], 0xd8c078);
    });
    /* 腕: 角袖（法被の袖）＋腕＋拳 */
    [['L',1],['R',-1]].forEach(function(e){
      var s=e[1];
      var sl=limb(V(s*0.12,0.555,0), V(s*0.152,0.445,0.004), 0.05, 0.064, 8);
      var uvs=sl.attributes.uv; for(var k=0;k<uvs.count;k++) uvs.setY(k, 0.55+uvs.getY(k)*0.3);
      B.add(sl, 'ua'+e[0], 0xffffff, REG.happi, 'happi');
      B.add(at(new T.CylinderGeometry(0.066,0.066,0.012,8,1,true),s*0.152,0.443,0.004), 'ua'+e[0], outfit.collar);
      B.add(limb(V(s*0.15,0.46,0), V(s*0.151,0.325,0.01), 0.029, 0.024, 7), 'fa'+e[0], skin);
      B.add(at(new T.SphereGeometry(0.034,8,6),s*0.152,0.3,0.012, 0.9,1.05,1), 'h'+e[0], skin);
      B.add(at(new T.SphereGeometry(0.014,5,4),s*0.152-s*0.022,0.312,0.03), 'h'+e[0], skin);
    });

    var built=B.build();
    var tex=sheet(outfit, opts.sheetSize||512);
    var mat=new T.MeshStandardMaterial({ map:tex, vertexColors:true, skinning:true, roughness:0.72, metalness:0, envMapIntensity:0.45 });
    var mesh=new T.SkinnedMesh(built.geo, mat);
    mesh.frustumCulled=false;
    /* 骨 */
    var bones=[], byName={};
    BONES.forEach(function(b){
      var bone=new T.Bone(); bone.name=b[0];
      if(b[1]){ var p=BONES[BI[b[1]]]; bone.position.set(b[2]-p[2], b[3]-p[3], b[4]-p[4]); }
      else bone.position.set(b[2],b[3],b[4]);
      bones.push(bone); byName[b[0]]=bone;
      if(b[1]) byName[b[1]].add(bone);
    });
    mesh.add(bones[0]);
    mesh.bind(new T.Skeleton(bones));
    var restPos={}; bones.forEach(function(b){ restPos[b.name]=b.position.clone(); });

    var root=new T.Group(); root.add(mesh);
    var scale=look.build||1; root.scale.setScalar(scale);

    /* 表情の切り替え用: 頭の貼り付け座標を4通り（普段・掛け声・喜び・悔しい）用意 */
    var faceTag=built.tags.face[0], uvAttr=built.geo.attributes.uv;
    var faceRegs={ calm:faceReg, shout:shoutReg, joy:REG.joy, sad:REG.sad }, faceUVs={};
    (function(){
      var src=faceTag.geo.attributes.uv;
      Object.keys(faceRegs).forEach(function(k){
        var r=faceRegs[k], arr=faceUVs[k]=new Float32Array(faceTag.count*2);
        for(var i=0;i<faceTag.count;i++){
          var u=src.getX(i), v=src.getY(i);
          arr[i*2]=r.x+u*r.w; arr[i*2+1]=1-(r.y+(1-v)*r.h);
        }
      });
    })();
    var faceState='calm';
    function setFace(s){
      if(!faceUVs[s]) s='calm';
      if(s===faceState) return; faceState=s;
      uvAttr.array.set(faceUVs[s], faceTag.start*2); uvAttr.needsUpdate=true;
    }
    /* 部分の色を塗り替える（鉢巻・帯の装備） */
    function tint(tag, hex){
      var list=built.tags[tag]; if(!list) return;
      var c=(hex && hex.isColor)?hex:new T.Color(hex), ca=built.geo.attributes.color;
      list.forEach(function(e){ for(var i=0;i<e.count;i++){ ca.setXYZ(e.start+i, c.r, c.g, c.b); } });
      ca.needsUpdate=true;
    }

    var av={
      root:root, mesh:mesh, bones:byName, mat:mat, outfit:outfit, look:look,
      setFace:setFace, tint:tint,
      /* 姿勢: p = { carry, side, heave, punch, crouch, lean, step, stepAmt, look, cheer, sag, roll, shout,
       *   face('calm'|'shout'|'joy'|'sad' 省略時は shout から), grip(担ぎ棒の位置 {x,y,z}・この人の座標。あれば内側の手で握る) } */
      pose:function(p){ applyPose(byName, restPos, p); setFace(p.face || (p.shout>0.5?'shout':'calm')); },
      face:function(){ return faceState; },
      items:[], aura:null
    };
    return av;
  }

  /* ---------- 姿勢計算 ---------- */
  function applyPose(b, rest, p){
    var carry=p.carry||0, side=p.side||1, heave=p.heave||0, punch=p.punch||0, crouch=p.crouch||0;
    var lean=p.lean||0, cheer=p.cheer||0, sag=p.sag||0, stepAmt=p.stepAmt||0, step=p.step||0;
    var inner=side>0?'L':'R', outer=side>0?'R':'L', so=side>0?-1:1; /* so: 外側の腕の向き */
    /* 脚: しゃがみ→伸び上がり、足踏み */
    var c=Math.max(0, crouch-heave*0.6);
    var sL=Math.sin(step), sR=Math.sin(step+Math.PI);
    b.thL.rotation.set(-0.55*c - stepAmt*0.45*Math.max(0,sL) + stepAmt*0.15*Math.max(0,-sL), 0, 0.02);
    b.thR.rotation.set(-0.55*c - stepAmt*0.45*Math.max(0,sR) + stepAmt*0.15*Math.max(0,-sR), 0, -0.02);
    b.kneeL.rotation.set(1.05*c + stepAmt*0.8*Math.max(0,sL), 0, 0);
    b.kneeR.rotation.set(1.05*c + stepAmt*0.8*Math.max(0,sR), 0, 0);
    b.ftL.rotation.set(-0.5*c + heave*0.35 - stepAmt*0.2*Math.max(0,sL), 0, 0);
    b.ftR.rotation.set(-0.5*c + heave*0.35 - stepAmt*0.2*Math.max(0,sR), 0, 0);
    b.hips.position.y = rest.hips.y - 0.05*c + heave*0.012 + stepAmt*0.012*Math.abs(Math.cos(step));
    b.hips.rotation.set(0, stepAmt*0.08*Math.sin(step), (p.roll||0)*0.5);
    /* 胴: 押し込みの前傾・落胆の丸まり */
    b.spine.rotation.set(0.22*lean + 0.12*c + 0.3*sag - 0.08*cheer, 0, (p.roll||0)*0.3);
    b.chest.rotation.set(0.12*lean + 0.25*sag - 0.1*cheer - 0.08*heave, 0, 0);
    /* 首・頭: 前傾やしゃがみで体が倒れても、顔は前（ぶつかる相手）を向く。落胆ではうなだれる */
    var lookUp=(1-sag)*(0.26*lean + 0.1*c);
    b.neck.rotation.set(0.1*sag - lookUp*0.4, 0, 0);
    b.head.rotation.set(0.28*sag - 0.18*cheer - 0.1*punch - lookUp*0.6, p.look||0, side*0.24*carry*(1-cheer)*(1-sag*0.5));
    /* 腕 */
    var ua={L:b.uaL, R:b.uaR}, fa={L:b.faL, R:b.faR}, sh={L:b.shL, R:b.shR};
    function armDown(k, sgn, swing){
      ua[k].rotation.set(swing, 0, sgn*0.12);
      fa[k].rotation.set(-0.25, 0, 0);
    }
    armDown('L', 1, stepAmt*0.35*Math.sin(step+Math.PI)); armDown('R', -1, stepAmt*0.35*Math.sin(step));
    if(carry>0){
      /* 内側の手は担ぎ棒を握る（肩の前・上） */
      var ki=inner, si=side;
      ua[ki].rotation.set(U.lerp(ua[ki].rotation.x, -1.9, carry), 0, U.lerp(ua[ki].rotation.z, si*0.3, carry));
      fa[ki].rotation.set(U.lerp(fa[ki].rotation.x, -0.95, carry), 0, 0);
      /* 外側の腕: 普段は腰に、掛け声で突き上げる */
      var ko=outer;
      var down=so*0.35, up=so*2.75;
      ua[ko].rotation.set(U.lerp(0.1, -0.35, punch)*carry + ua[ko].rotation.x*(1-carry), 0, U.lerp(ua[ko].rotation.z, U.lerp(down, up, punch), carry));
      fa[ko].rotation.set(U.lerp(-0.9, -0.15, punch)*carry + fa[ko].rotation.x*(1-carry), 0, 0);
    }
    if(cheer>0){
      ['L','R'].forEach(function(k){
        var sg=k==='L'?1:-1;
        ua[k].rotation.set(U.lerp(ua[k].rotation.x, -0.3, cheer), 0, U.lerp(ua[k].rotation.z, sg*2.7, cheer));
        fa[k].rotation.set(U.lerp(fa[k].rotation.x, -0.2, cheer), 0, 0);
      });
    }
    sh.L.rotation.set(0,0,heave*0.08*(side>0?1:0)); sh.R.rotation.set(0,0,-heave*0.08*(side<0?1:0));
    /* 内側の手で担ぎ棒を握る（棒の位置が渡されたときだけ。2本の骨の簡単な逆運動学） */
    if(p.grip && carry>0.5){
      var g=p.grip, gy=g.y-0.012, gz=0.16-U.clamp(gy-0.72,0,0.2)*0.6;
      _tgt.set(g.x, gy, gz);
      armIK(b, inner, _tgt);
      b['h'+inner].rotation.set(-0.3,0,0);
    } else { b.hL.rotation.set(0,0,0); b.hR.rotation.set(0,0,0); }
  }
  var UA_LEN=Math.hypot(BONES[BI.faL][2]-BONES[BI.uaL][2], BONES[BI.faL][3]-BONES[BI.uaL][3]);
  var FA_LEN=Math.hypot(BONES[BI.hL][2]-BONES[BI.faL][2], BONES[BI.hL][3]-BONES[BI.faL][3]);
  var _tgt=new T.Vector3(), _m1=new T.Matrix4(), _m2=new T.Matrix4(), _v1=new T.Vector3(), _vh=new T.Vector3(),
      _n=new T.Vector3(), _w=new T.Vector3(), _xl=new T.Vector3(), _tl=new T.Vector3(), _wl=new T.Vector3();
  /* target: 体（骨の根元）の座標で手を置きたい位置。肘は下へ曲げる */
  function armIK(b, k, target){
    var sh=b['sh'+k], ua=b['ua'+k], fa=b['fa'+k];
    b.hips.updateMatrix(); b.spine.updateMatrix(); b.chest.updateMatrix(); sh.updateMatrix();
    _m1.copy(b.hips.matrix).multiply(b.spine.matrix).multiply(b.chest.matrix).multiply(sh.matrix);
    _m2.copy(_m1).invert();
    _v1.copy(target).applyMatrix4(_m2).sub(ua.position);
    if(_v1.lengthSq()<1e-8) return;
    var a=UA_LEN, bl=FA_LEN, d=U.clamp(_v1.length(), Math.abs(a-bl)+0.01, a+bl-0.002);
    _vh.copy(_v1).normalize();
    _n.set(_vh.z, 0, -_vh.x);                 /* 曲げの面の向き（目標の向き×真下） */
    if(_n.lengthSq()<1e-6) _n.set(1,0,0);
    _n.normalize();
    var alpha=Math.acos(U.clamp((a*a+d*d-bl*bl)/(2*a*d),-1,1));
    var bend=Math.PI-Math.acos(U.clamp((a*a+bl*bl-d*d)/(2*a*bl),-1,1));
    _xl.set(1,0,0); _tl.set(0,-Math.cos(alpha),Math.sin(alpha)); _wl.crossVectors(_xl,_tl);
    _w.crossVectors(_n,_vh);
    _m1.makeBasis(_n,_vh,_w);
    _m2.makeBasis(_xl,_tl,_wl).transpose();
    _m1.multiply(_m2);
    ua.quaternion.setFromRotationMatrix(_m1);
    fa.rotation.set(-bend,0,0);
  }

  /* ---------- 装備（自分のアバター用の小物） ---------- */
  function haoriTexture(color, dragon){
    var S=256, c=G.canvas(S,S), cx=c.getContext && c.getContext('2d');
    if(cx){
      cx.fillStyle=U.hex(color); cx.fillRect(0,0,S,S);
      var g=cx.createLinearGradient(0,0,0,S); g.addColorStop(0,'rgba(255,255,255,0.12)'); g.addColorStop(1,'rgba(0,0,0,0.3)');
      cx.fillStyle=g; cx.fillRect(0,0,S,S);
      if(dragon){
        cx.strokeStyle='rgba(230,200,110,0.95)'; cx.lineWidth=10; cx.lineCap='round';
        cx.beginPath(); cx.moveTo(S*0.7,S*0.9);
        cx.bezierCurveTo(S*0.2,S*0.8,S*0.9,S*0.55,S*0.35,S*0.45);
        cx.bezierCurveTo(S*0.05,S*0.38,S*0.5,S*0.12,S*0.55,S*0.2); cx.stroke();
        cx.fillStyle='rgba(230,200,110,0.95)'; cx.beginPath(); cx.arc(S*0.57,S*0.2,14,0,Math.PI*2); cx.fill();
      } else {
        cx.fillStyle='rgba(255,200,120,0.35)';
        for(var i=0;i<7;i++){ cx.beginPath(); cx.moveTo(i*40, S); cx.quadraticCurveTo(i*40+20, S*0.55, i*40+40, S); cx.fill(); }
      }
    }
    return G.toTex(c, true, false);
  }
  function equip(av, item, particles){
    if(!item) return;
    var b=av.bones;
    function attach(bone, obj){ bone.add(obj); av.items.push(obj); return obj; }
    if(item.slot==='happi'){
      av.outfit=Object.assign({}, av.outfit, { happi:item.color });
      av.mat.map=sheet(av.outfit, av.mat.map && av.mat.map.image ? av.mat.map.image.width : 512); av.mat.needsUpdate=true;
    } else if(item.slot==='band'){
      if(item.rainbow) av.rainbowBand=true; else av.tint('band', item.color);
    } else if(item.slot==='obi'){
      av.tint('obi', item.color); av.goldObi=true;
    } else if(item.slot==='hand'){
      var g=new T.Group();
      if(item.kind==='fan'){
        var leaf=new T.Mesh(new T.CircleGeometry(0.11,16,0,Math.PI), new T.MeshStandardMaterial({ color:0xd8392a, side:T.DoubleSide, roughness:0.6, emissive:0x401008, emissiveIntensity:0.4 }));
        var sun=new T.Mesh(new T.CircleGeometry(0.035,14), new T.MeshStandardMaterial({ color:0xf6d878, side:T.DoubleSide, emissive:0x6a4a10, emissiveIntensity:0.6 }));
        sun.position.set(0,0.05,0.002); leaf.add(sun); leaf.position.y=0.03; g.add(leaf);
        g.rotation.set(0.3,0,0);
      } else {
        var pole=new T.Mesh(new T.CylinderGeometry(0.008,0.008,0.55,6), G.mat.woodDark()); pole.position.y=0.2; g.add(pole);
        var lan=new T.Mesh(new T.SphereGeometry(0.06,14,12), G.mat.lanternPaper(0xd8392a,'祭')); lan.scale.y=1.3; lan.position.y=0.42; g.add(lan);
        var gs=G.glowSprite(0xff9a50,0.45,1.3); gs.position.y=0.42; g.add(gs);
      }
      g.position.set(0,-0.02,0.02);
      attach(b.hR, g);
    } else if(item.slot==='haori'){
      var pts=[]; for(var i=0;i<=6;i++){ var t=i/6; pts.push(new T.Vector2(0.162+Math.sin(t*Math.PI)*0.004, 0.2+t*0.37)); }
      pts.push(new T.Vector2(0.06,0.6));
      var hg=new T.LatheGeometry(pts, 18, 0.5, Math.PI*2-1.0);
      var hm=new T.Mesh(hg, new T.MeshStandardMaterial({ map:haoriTexture(item.color, item.dragon), roughness:0.6, side:T.DoubleSide, envMapIntensity:0.6 }));
      hm.position.y=-0.48;
      attach(b.chest, hm);
    } else if(item.slot==='head'){
      var hgp=new T.Group();
      if(item.kind==='kitsune'){
        var white=new T.MeshStandardMaterial({ color:0xf8f3e8, roughness:0.35 }), red=new T.MeshStandardMaterial({ color:0xd8392a, roughness:0.5 });
        var face=new T.Mesh(new T.SphereGeometry(0.1,16,12,Math.PI*0.2,Math.PI*0.6,Math.PI*0.2,Math.PI*0.6), white); face.scale.set(1,1,0.8); hgp.add(face);
        var snout=new T.Mesh(new T.ConeGeometry(0.04,0.09,10), white); snout.rotation.x=Math.PI/2; snout.position.set(0,-0.02,0.095); hgp.add(snout);
        [-1,1].forEach(function(s){
          var ear=new T.Mesh(new T.ConeGeometry(0.032,0.08,6), white); ear.position.set(s*0.06,0.1,0.02); ear.rotation.z=-s*0.3; hgp.add(ear);
          var st=new T.Mesh(new T.BoxGeometry(0.04,0.008,0.008), red); st.position.set(s*0.04,0.02,0.1); st.rotation.z=s*0.4; hgp.add(st);
        });
        /* 頭の横にずらして掛ける（顔は見せる） */
        hgp.position.set(0.1,0.12,0.02); hgp.rotation.set(0,0.9,0.3);
      } else {
        var gm=G.mat.goldBright();
        var body=new T.Mesh(new T.ConeGeometry(0.05,0.16,10), gm); body.rotation.x=-0.5; body.position.set(0,0.2,-0.02); hgp.add(body);
        var tail=new T.Mesh(new T.ConeGeometry(0.06,0.08,4), gm); tail.position.set(0,0.3,-0.08); tail.rotation.x=0.8; hgp.add(tail);
        var ring=new T.Mesh(new T.TorusGeometry(0.135,0.014,8,24), gm); ring.rotation.x=Math.PI/2; ring.position.y=0.11; hgp.add(ring);
        [-1,1].forEach(function(s){ var fin=new T.Mesh(new T.ConeGeometry(0.02,0.08,4), gm); fin.position.set(s*0.12,0.14,0.03); fin.rotation.z=-s*0.8; hgp.add(fin); });
      }
      hgp.position.y+=HEAD_C-0.6;
      attach(b.head, hgp);
    } else if(item.slot==='aura'){
      av.aura={ kind:item.kind, color:item.color };
    }
  }

  /* チームの衣装を決める（連の色・柄・背紋の一文字） */
  var PALETTE=[0x24478f,0xb52a1c,0x2d7a52,0x5e3a92,0x1b1b2a,0xc9771e,0x2a6f8a];
  function teamOutfit(teamName, variant, avoidHappi){
    var h=U.hash(teamName||'祭');
    var pats=['asanoha','shima','kikko','seigaiha'];
    var idx=h%PALETTE.length, happi=PALETTE[idx];
    /* 相手と同じ色なら隣の色へずらす */
    if(avoidHappi!==undefined && happi===avoidHappi) happi=PALETTE[(idx+3)%PALETTE.length];
    var ch=(teamName||'祭').charAt(0);
    return { happi:happi, pattern:pats[(h>>>4)%pats.length], crest:ch, collar:happi===0x1b1b2a?0xb52a1c:0x14141e,
      band:0xf6f1e4, obi:0xf1ead8, pants:(h>>>7)%3===0?0x1d2233:0xf2eee4, tabi:0x1d2233 };
  }
  function randomLook(seed){
    var r=U.rng(seed||1);
    return { skin:Math.floor(r()*3), hair:Math.floor(r()*4), hairStyle:Math.floor(r()*3), face:r()<0.5?0:1, build:0.95+r()*0.1 };
  }

  MK.avatar = { build:build, equip:equip, teamOutfit:teamOutfit, randomLook:randomLook, HEAD_C:HEAD_C };
})();
