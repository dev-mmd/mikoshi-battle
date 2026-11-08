/* せーの！神輿バトル v2 — 会場（夕暮れの神社の境内）
 * 配置: 参道（Z方向）の中央が練り場。手前(-Z)が自分の連、奥(+Z)が相手の連。
 *   奥に朱の大鳥居(z=10)と拝殿(z=17)、両脇に石灯籠・結界の注連縄・観客・献灯の提灯棚・屋台、
 *   頭上に提灯の綱、外周に杉木立、遠くに山並みと夕焼け。
 * 同じ素材は結合・同じ形は「インスタンス」で1回の描画にまとめる。 */
(function(){
  'use strict';
  var MK = window.MK = window.MK || {};
  var G = MK.gfx, U = MK.util;
  var T = window.THREE;
  var P = function(){ return G.part.apply(null, arguments); };

  /* 光の玉（提灯のにじみ）をまとめて1回で描く */
  function halos(list){
    var n=list.length, pos=new Float32Array(n*3), size=new Float32Array(n), col=new Float32Array(n*4), rot=new Float32Array(n);
    list.forEach(function(h,i){
      pos[i*3]=h.x; pos[i*3+1]=h.y; pos[i*3+2]=h.z; size[i]=h.s;
      var c=new T.Color(h.c); col[i*4]=c.r*h.i; col[i*4+1]=c.g*h.i; col[i*4+2]=c.b*h.i; col[i*4+3]=1;
    });
    var ps=new G.Particles(1, G.tex.glow(), true);
    var g=new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos,3));
    g.setAttribute('psize', new T.BufferAttribute(size,1));
    g.setAttribute('pcolor', new T.BufferAttribute(col,4));
    g.setAttribute('prot', new T.BufferAttribute(rot,1));
    ps.points.geometry.dispose(); ps.points.geometry=g;
    ps.update=function(){}; /* 動かない */
    return ps.points;
  }

  /* ---------- 石灯籠 ---------- */
  function stoneLantern(stat, fire, x, z){
    var s=G.mat.stoneBlock();
    P(stat, new T.BoxGeometry(0.62,0.14,0.62), s, x,0.07,z);
    P(stat, new T.CylinderGeometry(0.22,0.28,0.16,6), s, x,0.22,z);
    P(stat, new T.CylinderGeometry(0.1,0.12,0.9,10), s, x,0.75,z);
    P(stat, new T.CylinderGeometry(0.32,0.22,0.14,6), s, x,1.25,z);
    P(fire, new T.BoxGeometry(0.34,0.3,0.34), G.mat.shoji(), x,1.47,z);
    [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(function(c){ P(stat, new T.BoxGeometry(0.06,0.32,0.06), s, x+c[0]*0.17,1.47,z+c[1]*0.17); });
    /* 笠（反った六角の屋根） */
    var pts=[new T.Vector2(0.02,0.36), new T.Vector2(0.12,0.28), new T.Vector2(0.34,0.1), new T.Vector2(0.5,0.02), new T.Vector2(0.52,0.07), new T.Vector2(0.5,0), new T.Vector2(0.2,0)];
    P(stat, new T.LatheGeometry(pts,6), s, x,1.62,z);
    P(stat, new T.SphereGeometry(0.08,10,8), s, x,2.04,z, 0,0,0, 1,1.2,1);
    P(stat, new T.ConeGeometry(0.05,0.1,8), s, x,2.14,z);
  }

  /* ---------- 大鳥居（明神鳥居） ---------- */
  function torii(stat, z){
    var shu=G.mat.shuMatte(), blk=G.mat.lacquer();
    [-2.9,2.9].forEach(function(x){
      P(stat, new T.CylinderGeometry(0.26,0.3,5.0,20), shu, x,2.5,z);
      P(stat, new T.CylinderGeometry(0.36,0.36,0.3,20), blk, x,0.15,z);   /* 根巻 */
      P(stat, new T.CylinderGeometry(0.34,0.34,0.06,20), G.mat.goldAged(), x,0.32,z);
    });
    P(stat, new T.BoxGeometry(7.0,0.3,0.34), shu, 0,3.95,z);            /* 貫 */
    P(stat, new T.BoxGeometry(0.3,0.75,0.26), shu, 0,4.45,z);           /* 額束 */
    /* 扁額 */
    var plaque=new T.Mesh(new T.PlaneGeometry(0.62,0.9), new T.MeshStandardMaterial({ map:plaqueTex(), roughness:0.6, emissive:0xffffff, emissiveMap:plaqueTex(), emissiveIntensity:0.25 }));
    plaque.position.set(0,4.45,z-0.2); plaque.rotation.y=Math.PI; stat.add(plaque);
    P(stat, new T.BoxGeometry(0.72,1.0,0.12), blk, 0,4.45,z-0.12);
    /* 島木＋笠木（両端が反り上がる） */
    P(stat, new T.BoxGeometry(7.4,0.26,0.5), shu, 0,4.95,z);
    var pts=[];
    for(var i=0;i<=24;i++){ var t=i/24*2-1; pts.push(new T.Vector3(t*4.4, 5.25+Math.pow(Math.abs(t),3)*0.42, 0)); }
    var kasagi=new T.TubeGeometry(new T.CatmullRomCurve3(pts), 48, 0.22, 8, false);
    P(stat, kasagi, blk, 0,0,z, 0,0,0, 1,1,1.35);
  }
  function plaqueTex(){
    if(plaqueTex.t) return plaqueTex.t;
    var c=G.canvas(128,192), cx=c.getContext && c.getContext('2d');
    if(cx){
      cx.fillStyle='#1a1420'; cx.fillRect(0,0,128,192);
      cx.strokeStyle='#d9b45a'; cx.lineWidth=8; cx.strokeRect(6,6,116,180);
      cx.fillStyle='#e8c46a'; cx.font='bold 64px "Hiragino Mincho ProN","Yu Mincho",serif'; cx.textAlign='center'; cx.textBaseline='middle';
      cx.fillText('祭',64,64); cx.fillText('禮',64,134);
    }
    plaqueTex.t=G.markShared(G.toTex(c, true, false));
    return plaqueTex.t;
  }

  /* ---------- 拝殿 ---------- */
  function hall(stat, glowStat, z){
    var shu=G.mat.shuMatte(), wood=G.mat.woodDark(), tile=G.mat.roofTile(), gold=G.mat.goldAged(), stone=G.mat.stoneBlock();
    /* 基壇と石段 */
    P(stat, new T.BoxGeometry(11,0.7,7), stone, 0,0.35,z+1);
    for(var i=0;i<4;i++) P(stat, new T.BoxGeometry(3.6,0.18,0.4), stone, 0,0.09+i*0.18,z-2.7+i*0.4);
    P(stat, new T.BoxGeometry(9.6,0.12,5.6), wood, 0,0.76,z+1);
    /* 柱と障子（中から灯りが漏れる） */
    for(i=0;i<6;i++){
      var x=-4+i*1.6;
      P(stat, new T.CylinderGeometry(0.16,0.17,3.0,14), shu, x,2.3,z-1.4);
      P(stat, new T.CylinderGeometry(0.16,0.17,3.0,14), shu, x,2.3,z+3.2);
    }
    P(glowStat, new T.BoxGeometry(8.4,2.4,0.1), G.withRepeat(G.mat.shoji(),5,1), 0,2.0,z-1.1);
    P(stat, new T.BoxGeometry(9.0,0.22,0.3), shu, 0,3.25,z-1.4);   /* 長押 */
    P(stat, new T.BoxGeometry(9.0,0.3,0.3), wood, 0,3.75,z-1.4);
    /* 組物 */
    for(i=0;i<9;i++){ P(stat, new T.BoxGeometry(0.3,0.2,0.4), gold, -4.2+i*1.05,3.95,z-1.45); }
    /* 大屋根（反りのある入母屋） */
    var pts=[], N=18;
    for(i=0;i<=N;i++){ var t=i/N; var y=Math.pow(1-t,1.6)*1.0; if(t>0.8){ var u=(t-0.8)/0.2; y+=u*u*0.2; } pts.push(new T.Vector2(0.02+t*1.0, y)); }
    pts.push(new T.Vector2(1.02,0.13)); pts.push(new T.Vector2(0.9,0.1));
    var roofG=new T.LatheGeometry(pts,4); roofG.rotateY(Math.PI/4);
    P(stat, roofG, G.withRepeat(tile,8,3), 0,4.1,z+1, 0,0,0, 8.2,3.0,5.6);
    /* 妻（棟の三角の板）と大棟・鬼瓦 */
    P(stat, new T.BoxGeometry(4.6,0.34,0.5), tile, 0,6.95,z+1);
    P(stat, new T.BoxGeometry(4.8,0.08,0.56), gold, 0,7.15,z+1);
    [-2.45,2.45].forEach(function(x){ P(stat, new T.BoxGeometry(0.34,0.6,0.62), tile, x,7.05,z+1); P(stat, new T.SphereGeometry(0.14,10,8), gold, x,7.42,z+1); });
    /* 唐破風（正面の曲線の庇） */
    var kp=[];
    for(i=0;i<=20;i++){ var tt=i/20*2-1; kp.push(new T.Vector3(tt*2.2, 4.75-Math.cos(tt*Math.PI*0.5)*0.0+ (1-tt*tt)*0.7 - Math.pow(Math.abs(tt),4)*0.25, z-3.3)); }
    P(stat, new T.TubeGeometry(new T.CatmullRomCurve3(kp),40,0.14,8,false), gold);
    var kpts=[]; for(i=0;i<=16;i++){ var tk=i/16; kpts.push(new T.Vector2(2.2*Math.sin(tk*Math.PI/2), 0.7*Math.cos(tk*Math.PI/2))); }
    var kara=new T.LatheGeometry(kpts, 2, -Math.PI/2, Math.PI);
    P(stat, new T.BoxGeometry(4.6,0.12,1.9), tile, 0,4.6,z-2.5);
    P(stat, kara, tile, 0,4.72,z-2.5, 0,0,0, 1,1,0.95);
    /* 大提灯と鈴緒 */
    var lp=G.mat.lanternPaper(0xd8392a,'祭');
    var big=P(glowStat, new T.SphereGeometry(0.62,24,18), lp, 0,2.1,z-2.2, 0,0,0, 1,1.45,1);
    P(stat, new T.CylinderGeometry(0.42,0.42,0.12,20), G.mat.lacquer(), 0,3.05,z-2.2);
    P(stat, new T.CylinderGeometry(0.42,0.42,0.12,20), G.mat.lacquer(), 0,1.15,z-2.2);
    [-2.4,2.4].forEach(function(x){
      P(stat, new T.CylinderGeometry(0.03,0.03,1.6,6), G.mat.rope(0xf2e8d0), x,2.1,z-1.7);
      P(stat, new T.SphereGeometry(0.16,12,10), gold, x,2.95,z-1.7);
    });
    /* 賽銭箱 */
    P(stat, new T.BoxGeometry(1.6,0.6,0.7), wood, 0,1.08,z-0.6);
    return big;
  }

  /* ---------- 献灯の提灯棚（インスタンス） ---------- */
  function lanternRacks(root, haloList){
    var stat=new T.Group(), wood=G.mat.woodDark();
    var spots=[];
    [-1,1].forEach(function(s){
      [-6.5,-1.5,3.5,8.0].forEach(function(z0){
        var x=s*4.9;
        P(stat, new T.BoxGeometry(0.12,2.9,0.12), wood, x,1.45,z0-1.8);
        P(stat, new T.BoxGeometry(0.12,2.9,0.12), wood, x,1.45,z0+1.8);
        [1.55,2.55].forEach(function(y){
          P(stat, new T.BoxGeometry(0.1,0.08,3.8), wood, x,y+0.38,z0);
          for(var k=0;k<7;k++) spots.push([x, y, z0-1.5+k*0.5]);
        });
        P(stat, new T.BoxGeometry(0.5,0.1,4.0), G.mat.lacquer(), x,2.98,z0);
      });
    });
    root.add(G.mergeGroup(stat, { castShadow:false }));
    var n=spots.length, geo=new T.SphereGeometry(0.17,10,8); geo.scale(1,1.35,1);
    var colors=[0xf2c27a, 0xd23a24];
    var groups=[[],[]];
    spots.forEach(function(p,i){ groups[(i*7+Math.floor(i/7))%5===0?1:0].push(p); });
    groups.forEach(function(list, gi){
      var mat=G.mat.lanternPaper(colors[gi], gi?'祭':'奉');
      var im=new T.InstancedMesh(geo, mat, list.length), m=new T.Matrix4();
      list.forEach(function(p,i){ m.makeTranslation(p[0],p[1],p[2]); im.setMatrixAt(i,m); haloList.push({ x:p[0], y:p[1], z:p[2], s:0.8, c:gi?0xff6a3a:0xffb060, i:0.35 }); });
      root.add(im);
    });
  }

  /* ---------- 頭上の提灯の綱 ---------- */
  function lanternStrings(root, haloList){
    var wire=new T.Group(), spots=[];
    function string(a, b, sag, count){
      var pts=[];
      for(var i=0;i<=20;i++){
        var t=i/20; pts.push(new T.Vector3(U.lerp(a.x,b.x,t), U.lerp(a.y,b.y,t)-Math.sin(t*Math.PI)*sag, U.lerp(a.z,b.z,t)));
      }
      P(wire, new T.TubeGeometry(new T.CatmullRomCurve3(pts),30,0.012,4,false), G.mat.plain(0x1a1418,0.8));
      for(var k=1;k<=count;k++){
        var tt=k/(count+1); spots.push([U.lerp(a.x,b.x,tt), U.lerp(a.y,b.y,tt)-Math.sin(tt*Math.PI)*sag-0.22, U.lerp(a.z,b.z,tt)]);
      }
    }
    [-9.5, 0.5, 7.5].forEach(function(z){ string(new T.Vector3(-4.6,6.0,z), new T.Vector3(4.6,6.0,z), 0.8, 11); });
    /* 縦の綱は柱（x=±4.6）に結ぶ。以前は x=±3.9 で両端が宙に浮き、試合カメラ（x≈4.3）のすぐ下を通って
     * 手前に大きな提灯がかぶっていた */
    [-1,1].forEach(function(s){
      string(new T.Vector3(s*4.6,4.0,-9.5), new T.Vector3(s*4.6,4.0,0.5), 0.45, 8);
      string(new T.Vector3(s*4.6,4.0,0.5), new T.Vector3(s*4.6,4.0,7.5), 0.4, 6);
    });
    /* 綱を張る柱 */
    [-9.5,0.5,7.5].forEach(function(z){ [-4.6,4.6].forEach(function(x){ P(wire, new T.CylinderGeometry(0.07,0.08,6.1,8), G.mat.woodDark(), x,3.05,z); }); });
    root.add(G.mergeGroup(wire, { castShadow:false }));
    var geo=new T.SphereGeometry(0.15,10,8); geo.scale(1,1.3,1);
    /* 色は朱と温かい和紙色に絞る（白っぽい紙は光ると白く飛ぶので、灯の入った黄みに） */
    var PAPER=0xf2c27a, pal=[0xd23a24, PAPER, 0xd23a24, 0xf0a040];
    var byC={};
    spots.forEach(function(p,i){ var c=pal[i%pal.length]; (byC[c]=byC[c]||[]).push(p); });
    var swayers=[];
    Object.keys(byC).forEach(function(k){
      var list=byC[k], c=+k;
      var im=new T.InstancedMesh(geo, G.mat.lanternPaper(c, c===PAPER?'祭':null), list.length), m=new T.Matrix4();
      list.forEach(function(p,i){ m.makeTranslation(p[0],p[1],p[2]); im.setMatrixAt(i,m); haloList.push({ x:p[0], y:p[1], z:p[2], s:0.9, c:c===PAPER?0xffb060:0xff6a3a, i:0.45 }); });
      im.userData.spots=list; swayers.push(im);
      root.add(im);
    });
    return swayers;
  }

  /* ---------- 屋台 ---------- */
  var STALLS=['たこ焼','金魚','りんご飴','焼そば','綿菓子','射的'];
  function awningTex(){
    if(awningTex.t) return awningTex.t;
    var c=G.canvas(256,64), cx=c.getContext && c.getContext('2d');
    if(cx){ for(var i=0;i<8;i++){ cx.fillStyle=i%2?'#f4ecdc':'#c8321e'; cx.fillRect(i*32,0,32,64); } cx.fillStyle='rgba(0,0,0,0.2)'; cx.fillRect(0,54,256,10); }
    awningTex.t=G.markShared(G.toTex(c,true,true)); return awningTex.t;
  }
  /* 暖簾の文字は全店分を1枚の絵（縦に並べる）にまとめ、素材も1つにする（店ごとの素材は描画回数が増える） */
  function norenAtlas(){
    if(norenAtlas.m) return norenAtlas.m;
    var n=STALLS.length, c=G.canvas(512,1024), cx=c.getContext && c.getContext('2d');   /* 1段=512×128（暖簾の縦横比に近い）×8段 */
    if(cx){
      cx.fillStyle='#f6eedb'; cx.fillRect(0,0,512,1024);
      cx.fillStyle='#b8261a'; cx.font='bold 84px "Hiragino Mincho ProN","Yu Mincho",serif'; cx.textAlign='center'; cx.textBaseline='middle';
      for(var i=0;i<n;i++) cx.fillText(STALLS[i],256,128*i+68);
    }
    var t=G.toTex(c,true,false);
    norenAtlas.m=G.markShared(new T.MeshStandardMaterial({ map:t, roughness:0.8, emissive:0xffffff, emissiveMap:t, emissiveIntensity:0.3, envMapIntensity:0.3 }));
    G.markShared(t);
    return norenAtlas.m;
  }
  function norenGeo(idx){
    var g=new T.PlaneGeometry(2.4,0.55), uv=g.attributes.uv;
    for(var i=0;i<uv.count;i++) uv.setY(i, 1-(idx+1-uv.getY(i))/8);
    return g;
  }
  function stalls(stat, glowStat, root){
    var k=0;
    var awMat=G.markShared(new T.MeshStandardMaterial({ map:awningTex(), side:T.DoubleSide, roughness:0.8, envMapIntensity:0.3 }));
    var awGeo=new T.PlaneGeometry(2.8,1.3);
    [-1,1].forEach(function(s){
      [-9,-3.5,2,7.5].forEach(function(z){
        var x=s*7.4, ni=k++%STALLS.length, ry=s>0?-Math.PI/2:Math.PI/2;
        var g=new T.Group(); g.position.set(x,0,z); g.rotation.y=ry; stat.add(g);
        P(g, new T.BoxGeometry(2.6,0.9,1.0), G.mat.woodDark(), 0,0.45,0.2);
        [-1.25,1.25].forEach(function(px){ P(g, new T.CylinderGeometry(0.05,0.05,2.3,6), G.mat.woodDark(), px,1.15,0.6); P(g, new T.CylinderGeometry(0.05,0.05,2.3,6), G.mat.woodDark(), px,1.15,-0.4); });
        var aw=new T.Mesh(awGeo, awMat);
        aw.position.set(0,2.25,0.25); aw.rotation.x=-Math.PI/2+0.35; g.add(aw);
        var nr=new T.Mesh(norenGeo(ni), norenAtlas());
        nr.position.set(0,1.85,0.87); g.add(nr);
        var inner=new T.Mesh(new T.PlaneGeometry(2.4,1.2), G.mat.glow(0xffa860, 1.3));
        inner.position.set(0,1.3,-0.45); g.add(inner);
        /* 売り物の彩り */
        for(var i=0;i<6;i++) P(g, new T.SphereGeometry(0.08,8,6), G.mat.plain([0xff5040,0xffd060,0xff90c0,0x60c0ff][i%4],0.4), -0.9+i*0.36,0.97,0.35);
      });
    });
  }

  /* ---------- 観客（インスタンス） ---------- */
  function crowd(root){
    var spots=[], rng=U.rng(2024);
    [-1,1].forEach(function(s){
      for(var z=-11;z<=12;z+=0.62){
        for(var row=0;row<3;row++){
          if(rng()<0.18) continue;
          spots.push({ x:s*(2.95+row*0.5+rng()*0.25), z:z+rng()*0.4, s:s, h:0.9+rng()*0.25, ph:rng()*6, sp:1+rng()*1.5 });
        }
      }
    });
    /* 胴（浴衣）: 色は人ごと。頭: 肌と髪の色を頂点色で */
    var body=new T.CylinderGeometry(0.14,0.2,0.9,8); body.translate(0,0.45,0);
    var head=new T.SphereGeometry(0.12,8,6); head.translate(0,1.02,0);
    var hairG=new T.SphereGeometry(0.125,8,4,0,Math.PI*2,0,Math.PI*0.55); hairG.translate(0,1.03,-0.01);
    function colorize(g, hex){ var c=new T.Color(hex), n=g.attributes.position.count, a=new Float32Array(n*3); for(var i=0;i<n;i++){ a[i*3]=c.r; a[i*3+1]=c.g; a[i*3+2]=c.b; } g.setAttribute('color', new T.BufferAttribute(a,3)); }
    colorize(head, 0xf2c9a0); colorize(hairG, 0x1a1418);
    var headG=G.mergeGeometries([{ geo:head, matrix:new T.Matrix4() }, { geo:hairG, matrix:new T.Matrix4() }]);
    var n=spots.length;
    /* 観客は脇役: 色を少し沈めて神輿より目立たせない */
    var bodies=new T.InstancedMesh(body, new T.MeshStandardMaterial({ color:0x9a9a9a, roughness:0.85, envMapIntensity:0.3 }), n);
    var heads=new T.InstancedMesh(headG, new T.MeshStandardMaterial({ vertexColors:true, color:0xb0b0b0, roughness:0.8, envMapIntensity:0.3 }), n);
    var yukata=[0x2b4a8a,0xd8a0b8,0xf0e6d0,0x3a6a5a,0xc84a3a,0x6a4a9a,0xe8c060,0x284060,0xf2b8a0];
    var col=new T.Color();
    spots.forEach(function(p,i){ col.setHex(yukata[i%yukata.length]); bodies.setColorAt(i, col); });
    if(bodies.instanceColor) bodies.instanceColor.needsUpdate=true;
    root.add(bodies); root.add(heads);
    var m=new T.Matrix4(), q=new T.Quaternion(), sc=new T.Vector3(), ps=new T.Vector3(), eu=new T.Euler();
    var state={ hype:0, jump:0 };
    function update(t, dt){
      state.jump=Math.max(0, state.jump-dt*1.4);
      for(var i=0;i<n;i++){
        var p=spots[i];
        var bob=Math.abs(Math.sin(t*p.sp*(1+state.hype)+p.ph))*(0.02+state.hype*0.08);
        var jmp=state.jump>0?Math.max(0,Math.sin((1-state.jump)*Math.PI*3+p.ph))*0.25*state.jump:0;
        eu.set(0, p.s>0?-Math.PI/2:Math.PI/2, Math.sin(t*0.7+p.ph)*0.05); q.setFromEuler(eu);
        sc.set(1, p.h, 1); ps.set(p.x, bob+jmp, p.z);
        m.compose(ps, q, sc); bodies.setMatrixAt(i, m);
        sc.set(1,1,1); ps.set(p.x, bob+jmp+(p.h-1)*0.9, p.z); m.compose(ps, q, sc); heads.setMatrixAt(i, m);
      }
      bodies.instanceMatrix.needsUpdate=true; heads.instanceMatrix.needsUpdate=true;
    }
    update(0,0);
    return { update:update, state:state };
  }

  /* ---------- 杉木立・山並み・空 ---------- */
  function forest(root){
    var spots=[], rng=U.rng(55);
    for(var i=0;i<46;i++){
      var a=rng()*Math.PI*2, side=rng()<0.5?-1:1;
      var x, z;
      if(i<16){ x=-15+i*2+rng(); z=24+rng()*6; }
      else { x=side*(10.5+rng()*7); z=-16+rng()*40; }
      spots.push({ x:x, z:z, h:7+rng()*6, r:1.3+rng()*0.8 });
    }
    var trunk=new T.CylinderGeometry(0.18,0.3,1,8); trunk.translate(0,0.5,0);
    var cone=new T.ConeGeometry(1,1,9); cone.translate(0,0.5,0);
    var tm=new T.InstancedMesh(trunk, G.mat.plain(0x3a2418,0.9), spots.length);
    var layers=4, fm=new T.InstancedMesh(cone, new T.MeshStandardMaterial({ color:0xffffff, roughness:0.9, envMapIntensity:0.25 }), spots.length*layers);
    var m=new T.Matrix4(), k=0, col=new T.Color();
    spots.forEach(function(s,i){
      m.compose(new T.Vector3(s.x,0,s.z), new T.Quaternion(), new T.Vector3(1,s.h*0.55,1)); tm.setMatrixAt(i,m);
      for(var l=0;l<layers;l++){
        var y=s.h*(0.28+l*0.17), sc=s.r*(1-l*0.2);
        m.compose(new T.Vector3(s.x,y,s.z), new T.Quaternion().setFromEuler(new T.Euler(0,l,0)), new T.Vector3(sc,s.h*0.36,sc));
        fm.setMatrixAt(k, m); col.setHSL(0.42, 0.35, 0.13+l*0.025); fm.setColorAt(k, col); k++;
      }
    });
    if(fm.instanceColor) fm.instanceColor.needsUpdate=true;
    root.add(tm); root.add(fm);
  }
  function mountains(root){
    var g=new T.Group(), mat=new T.MeshBasicMaterial({ color:0x2a1f3a, fog:true });
    var mat2=new T.MeshBasicMaterial({ color:0x3d2a48, fog:true });
    [[-30,58,22,9],[0,70,34,12],[28,60,26,10],[-55,48,20,7],[52,52,22,8]].forEach(function(p,i){
      var cone=new T.ConeGeometry(p[2],p[3],7); P(g, cone, i%2?mat:mat2, p[0],p[3]/2-1,p[1]);
    });
    root.add(G.mergeGroup(g, { castShadow:false }));   /* 5回→2回の描画に */
  }
  function sky(root){
    var mat=new T.MeshBasicMaterial({ map:G.tex.sky(), side:T.BackSide, depthWrite:false, fog:false });
    mat.color.setScalar(1.25);
    var s=new T.Mesh(new T.SphereGeometry(90,40,20), mat);
    s.rotation.y=Math.PI; /* 夕陽を奥(+Z)の拝殿の向こうへ */
    s.renderOrder=-10;
    root.add(s);
    return s;
  }

  /* ---------- 組み立て ---------- */
  function build(scene, opts){
    opts=opts||{};
    var root=new T.Group(); root.name='venue';
    scene.fog=new T.Fog(0x2a1c34, 18, 70);
    sky(root); mountains(root); forest(root);
    /* 地面: 玉砂利＋参道の石畳 */
    var ground=new T.Mesh(new T.PlaneGeometry(90,90), G.withRepeat(G.mat.gravel(), 22, 22));
    ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; root.add(ground);
    var path=new T.Mesh(new T.PlaneGeometry(5.2,44), G.withRepeat(G.mat.stone(), 1.4, 12));
    path.rotation.x=-Math.PI/2; path.position.set(0,0.012,0); path.receiveShadow=true; root.add(path);
    /* 練り場の白線（結界の内側） */
    var lineMat=new T.MeshBasicMaterial({ color:0xf4ecd8, transparent:true, opacity:0.45, depthWrite:false });
    var lines=new T.Group();
    [-5.6,5.6].forEach(function(z){ var l=new T.Mesh(new T.PlaneGeometry(4.4,0.08), lineMat); l.rotation.x=-Math.PI/2; l.position.set(0,0.02,z); lines.add(l); });
    var cl=new T.Mesh(new T.RingGeometry(0.5,0.56,48), lineMat); cl.rotation.x=-Math.PI/2; cl.position.y=0.02; lines.add(cl);
    var linesM=G.mergeGroup(lines, { castShadow:false }); linesM.children.forEach(function(c){ c.renderOrder=1; }); root.add(linesM);

    var stat=new T.Group(), glowStat=new T.Group(), fire=new T.Group();
    var haloList=[];
    [-8,-4,0,4,8,12].forEach(function(z){ [-1,1].forEach(function(s){
      stoneLantern(stat, fire, s*3.3, z);
      haloList.push({ x:s*3.3, y:1.47, z:z, s:0.95, c:0xffa050, i:0.6 });
    }); });
    /* 結界の注連縄（竹の柱＋縄＋紙垂） */
    var bamboo=G.mat.plain(0x6a8a3a,0.6), shideM=new T.MeshStandardMaterial({ color:0xfbf7ee, roughness:0.7, side:T.DoubleSide, emissive:0x302820, emissiveIntensity:0.3 });
    [-1,1].forEach(function(s){
      var zs=[-6,-2,2,6];
      zs.forEach(function(z){ P(stat, new T.CylinderGeometry(0.05,0.05,1.5,8), bamboo, s*2.55,0.75,z); });
      for(var i=0;i<zs.length-1;i++){
        var a=zs[i], b=zs[i+1], pts=[];
        for(var k=0;k<=10;k++){ var t=k/10; pts.push(new T.Vector3(s*2.55, 1.35-Math.sin(t*Math.PI)*0.22, U.lerp(a,b,t))); }
        P(stat, new T.TubeGeometry(new T.CatmullRomCurve3(pts),16,0.045,6,false), G.mat.rope(0xc9b68a));
        for(k=1;k<4;k++){
          var tt=k/4, zz=U.lerp(a,b,tt), yy=1.35-Math.sin(tt*Math.PI)*0.22;
          var sh=new T.Mesh(new T.PlaneGeometry(0.1,0.28), shideM); sh.position.set(s*2.55,yy-0.17,zz); sh.rotation.y=Math.PI/2; sh.rotation.z=0.12; stat.add(sh);
        }
      }
    });
    torii(stat, 10.2);
    var bigLantern=hall(stat, glowStat, 17.5);
    haloList.push({ x:0, y:2.1, z:15.3, s:4.5, c:0xff6a3a, i:0.9 });
    stalls(stat, glowStat, root);
    root.add(G.mergeGroup(stat, { castShadow:false, receiveShadow:true }));
    root.add(G.mergeGroup(glowStat, { castShadow:false }));
    root.add(G.mergeGroup(fire, { castShadow:false }));
    lanternRacks(root, haloList);
    var swayers=lanternStrings(root, haloList);
    root.add(halos(haloList));
    var people=crowd(root);

    /* 灯り（点光源は4つまで。残りは発光とにじみで表現） */
    var lights=[];
    [[-3.3,1.9,-2],[3.3,1.9,3],[0,2.4,14.5],[-3.3,1.9,8]].forEach(function(p,i){
      var l=new T.PointLight(i===2?0xff7a40:0xffa860, i===2?2.4:1.4, i===2?10:7.5, 2);
      l.position.set(p[0],p[1],p[2]); root.add(l); lights.push(l);
    });

    /* 空の花火 */
    var fwPs=new G.Particles(900, G.tex.glow(), true);
    root.add(fwPs.points);
    var fwTimer=2;
    scene.add(root);
    return {
      root:root, crowd:people, lights:lights, bigLantern:bigLantern,
      fireworkRate:opts.fireworkRate||0.12,
      firework:function(x,y,z){ G.fx.firework(fwPs, x===undefined?U.rand(-14,14):x, y===undefined?U.rand(13,20):y, z===undefined?U.rand(22,34):z); if(MK.audio.ready()) MK.audio.don(0, 0.25); },
      update:function(dt, t){
        people.update(t, dt);
        people.state.hype=U.damp(people.state.hype, this.hypeTarget||0, 2, dt);
        fwTimer-=dt*(this.fireworkRate||0)*(MK.reduceMotion?0.25:1);
        if(fwTimer<=0){ fwTimer=1+Math.random()*2; this.firework(); }
        lights.forEach(function(l,i){ l.intensity=(i===2?2.4:1.4)*(0.92+Math.sin(t*9+i*3)*0.04+Math.sin(t*23+i)*0.03); });
      },
      cheer:function(level){ people.state.jump=Math.min(1, (level||1)); },
      setHype:function(h){ this.hypeTarget=h; }
    };
  }

  MK.venue = { build:build };
})();
