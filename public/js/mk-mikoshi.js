/* せーの！神輿バトル v2 — 神輿（9様式）
 * 寸法は v1（検証済み）を引き継ぐ: 台輪幅1.52・胴0.82・反り屋根・蕨手・鳳凰。
 * 座標: 地面 y=0、担ぎ棒は X 方向（長さ3.3）、正面は +Z。担ぎ棒の下端は地面から約0.61（担ぎ手の肩の高さ）。
 * 同じ素材の部品は結合して描画回数を抑え、揺らす部品（鳳凰・房・鈴）だけ別に残す。 */
(function(){
  'use strict';
  var MK = window.MK = window.MK || {};
  var G = MK.gfx, U = MK.util, C = MK.C;
  var T = window.THREE;
  var P = function(){ return G.part.apply(null, arguments); };

  /* v1 の座標系（担ぎ棒 y=-0.94・地面 y=-1.6）で組み、最後に 1.6 持ち上げる */
  var GROUND = -1.6;
  var POLE_Y = -0.94, POLE_Z = 0.4, POLE_LEN = 3.3, POLE_R = 0.052;

  function roofMaterial(kind){
    if(kind==='shu') return G.mat.shu();
    if(kind==='gold') return G.withRepeatShared(G.mat.gold(), 4, 1);
    if(kind==='woodDark') return G.mat.woodDark();
    return G.mat.lacquer();
  }
  function bodyMaterial(kind){
    if(kind==='gold') return G.mat.gold();
    if(kind==='ivory') return G.mat.ivory();
    if(kind==='wood') return G.mat.wood();
    if(kind==='shu') return G.mat.shu();
    return G.mat.lacquer();
  }

  /* ---------- 部品 ---------- */
  /* 唐破風風の反り屋根: 深く凹んでから軒先で跳ね上がる（Lathe の面数で四角・六角・八角） */
  function roofY(t){ var y=0.58*Math.pow(1-t,1.85); if(t>0.68){ var u=(t-0.68)/0.32; y+=u*u*0.34; } return y; }
  function curvedRoof(parent, mat, sides){
    var pts=[], N=22;
    for(var i=0;i<=N;i++){ var t=i/N; pts.push(new T.Vector2(0.06+t*1.16, roofY(t))); }
    pts.push(new T.Vector2(1.225,0.16));
    pts.push(new T.Vector2(1.215,0.125));
    /* 軒裏は台（軒板）の上まで下ろして、屋根と軒板の間のすき間をなくす */
    pts.push(new T.Vector2(1.06,0.06));
    pts.push(new T.Vector2(0.86,0.035));
    /* 角の向きを胴（bodyRot）とそろえる。π/sides だと六角だけ屋根が30°ずれていた */
    var geo=new T.LatheGeometry(pts, sides); geo.rotateY(Math.PI/2-Math.PI/sides);
    return P(parent, geo, mat);
  }
  /* 屋根の隅棟（金の稜線）と蕨手。y0=屋根の置き高さ, sy=高さの縮尺, k=太さ・蕨手の縮尺 */
  function roofRidges(parent, mat, sides, rsx, rsz, y0, sy, k){
    k=k||1;
    for(var hi=0;hi<sides;hi++){
      var a2=Math.PI/sides+hi*Math.PI*2/sides, ca=Math.cos(a2), sa=Math.sin(a2);
      var hp=[];
      for(var hk=0;hk<=12;hk++){ var ht=hk/12, hr=0.06+ht*1.16; hp.push(new T.Vector3(ca*hr*rsx, y0+sy*roofY(ht)+0.022*k, sa*hr*rsz)); }
      P(parent, new T.TubeGeometry(new T.CatmullRomCurve3(hp),30,0.021*k,6,false), mat);
      var wb=warabite(mat);
      wb.position.set(ca*1.2*rsx, y0+sy*roofY(1)+0.01*k, sa*1.2*rsz);
      wb.rotation.y=-Math.atan2(sa*rsz, ca*rsx);
      wb.scale.setScalar(k);
      parent.add(wb);
    }
  }
  /* 座布団（中央がふくらみ、縁がつまむように薄くなる）。BoxGeometry の頂点を押して作る */
  function futonGeo(w, h, d){
    var g=new T.BoxGeometry(1,1,1,6,2,6), p=g.attributes.position;
    for(var i=0;i<p.count;i++){
      var x=p.getX(i), y=p.getY(i), z=p.getZ(i);
      var m=Math.min(1, Math.max(Math.abs(x),Math.abs(z))*2);
      var bulge=1+0.05*(1-Math.abs(y)*2);           /* 側面は中ほどがふくらむ */
      p.setXYZ(i, x*bulge, y*(1-0.38*Math.pow(m,2.5)), z*bulge);
    }
    g.computeVertexNormals();
    g.scale(w,h,d);
    return g;
  }
  /* 神輿で使い回す素材（作るのは1回だけ。場面の片付けで捨てない） */
  var SH={};
  function shared(key, fn){ if(!SH[key]) SH[key]=G.markShared(fn()); return SH[key]; }
  function clothMat(hex){
    return shared('cloth'+hex, function(){
      var t=G.tex.fabric();
      return new T.MeshStandardMaterial({ color:hex, normalMap:t.normalMap, normalScale:new T.Vector2(0.35,0.35), roughness:0.72, metalness:0, envMapIntensity:0.35 });
    });
  }
  /* 蕨手: ワラビの芽のように上へ立ち上がり内へ巻く金具 */
  function warabite(mat){
    var pts=[];
    for(var i=0;i<=20;i++){
      var t=i/20, a=t*Math.PI*2.3, r=0.11*(1-t*0.72);
      pts.push(new T.Vector3(0.1-Math.cos(a)*r, 0.02+t*0.08+Math.sin(a)*r, 0));
    }
    pts.unshift(new T.Vector3(0,0,0));
    var g=new T.Group();
    P(g, new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, 0.017, 7, false), mat);
    P(g, new T.SphereGeometry(0.026, 10, 8), mat, pts[pts.length-1].x, pts[pts.length-1].y, 0);
    return g;
  }
  function medallionRow(parent, mat, hx, hz, y){
    var disc=new T.CylinderGeometry(0.052,0.052,0.018,14), ring=new T.TorusGeometry(0.058,0.01,6,16);
    function row(side,n,span){
      for(var i=0;i<n;i++){
        var t=-span+(i/(n-1))*span*2, x, z, ry;
        if(side===0){ x=t; z=hz; ry=0; } else if(side===1){ x=t; z=-hz; ry=Math.PI; }
        else if(side===2){ x=hx; z=t; ry=Math.PI/2; } else { x=-hx; z=t; ry=-Math.PI/2; }
        var g=new T.Group(); g.position.set(x,y,z); g.rotation.y=ry; parent.add(g);
        P(g, disc, mat, 0,0,0.004, Math.PI/2,0,0);
        P(g, ring, mat, 0,0,0.012);
      }
    }
    row(0,5,hx*0.82); row(1,5,hx*0.82); row(2,4,hz*0.76); row(3,4,hz*0.76);
  }
  /* 枡組（軒下の組物） */
  function masugumi(parent, mat, hx, hz, y){
    var cube=new T.BoxGeometry(0.075,0.05,0.075), arm=new T.BoxGeometry(0.16,0.034,0.05), arm2=new T.BoxGeometry(0.1,0.03,0.045);
    function row(side,n,span){
      for(var i=0;i<n;i++){
        var t=-span+(i/(n-1))*span*2, x=0, z=0, rot=0;
        if(side===0){ x=t; z=hz; } else if(side===1){ x=t; z=-hz; }
        else if(side===2){ x=hx; z=t; rot=Math.PI/2; } else { x=-hx; z=t; rot=Math.PI/2; }
        P(parent, cube, mat, x, y, z);
        P(parent, arm, mat, x, y+0.042, z, 0, rot, 0);
        P(parent, arm2, mat, x, y+0.078, z, 0, rot, 0);
      }
    }
    row(0,4,hx*0.66); row(1,4,hx*0.66); row(2,3,hz*0.6); row(3,3,hz*0.6);
  }
  /* 鳳凰の翼の形: 付け根から上外側へ伸び、下の縁が5枚の羽根で波打つ */
  function wingGeometry(k){
    var sh=new T.Shape();
    sh.moveTo(0,0);
    sh.bezierCurveTo(0.08*k,0.1*k, 0.2*k,0.3*k, 0.44*k,0.4*k);
    var n=5, px=0.44*k, py=0.4*k;
    for(var i=1;i<=n;i++){
      var t=i/n, x=U.lerp(0.44*k,0.06*k,t), y=U.lerp(0.4*k,0.02*k,t)-0.02*k;
      sh.quadraticCurveTo((px+x)/2+0.05*k, (py+y)/2-0.09*k, x, y);
      px=x; py=y;
    }
    sh.lineTo(0,0);
    var geo=new T.ExtrudeGeometry(sh, { depth:0.012, bevelEnabled:true, bevelThickness:0.006, bevelSize:0.006, bevelSegments:1, curveSegments:6 });
    geo.translate(0,0,-0.006);
    return geo;
  }
  /* 大鳳凰: 翼を広げ、長い尾羽を後ろへ流す */
  function phoenix(m, mg){
    var g=new T.Group();
    var bp=[];
    for(var i=0;i<=12;i++){ var t=i/12; bp.push(new T.Vector2(0.085*Math.sin(t*Math.PI)*(1-t*0.28), t*0.3)); }
    P(g, new T.LatheGeometry(bp,12), mg, 0,0.05,0.02, Math.PI/2-0.28,0,0);
    P(g, new T.SphereGeometry(0.062,12,10), m, 0,0.075,0.13, 0,0,0, 0.85,1.1,0.85);
    P(g, new T.TubeGeometry(new T.CatmullRomCurve3([
      new T.Vector3(0,0.10,0.14), new T.Vector3(0,0.17,0.20), new T.Vector3(0,0.245,0.205), new T.Vector3(0,0.29,0.185)
    ]),14,0.026,8,false), m);
    P(g, new T.SphereGeometry(0.046,12,10), m, 0,0.30,0.185, 0,0,0, 0.9,0.95,1.15);
    P(g, new T.ConeGeometry(0.019,0.075,8), m, 0,0.293,0.245, Math.PI/2+0.18,0,0);
    for(i=-1;i<=1;i++) P(g, new T.ConeGeometry(0.009,0.1,5), m, i*0.018,0.37,0.165-Math.abs(i)*0.012, -0.5,0,i*0.35);
    /* 翼: 羽根の縁が波打つ扇形の板を2枚重ね、上へ反らせて大きく広げる */
    var wing=wingGeometry(0.78), wing2=wingGeometry(0.56);
    for(var s=-1;s<=1;s+=2){
      var wg=new T.Group(); wg.position.set(s*0.05,0.13,0.02); wg.rotation.set(-0.35, s*0.55, s*0.18); g.add(wg);
      P(wg, wing, mg, 0,0,0, 0,0,0, s,1,1);
      P(wg, wing2, m, s*0.015,0.035,0.016, 0,0,0, s,1,1);
    }
    /* 尾羽: 5本の長い曲線＋先の宝珠 */
    for(i=0;i<5;i++){
      var k=i-2;
      var end=new T.Vector3(k*0.15,0.36-Math.abs(k)*0.05,-0.52);
      P(g, new T.TubeGeometry(new T.CatmullRomCurve3([
        new T.Vector3(0,0.05,-0.08), new T.Vector3(k*0.05,0.10,-0.24), new T.Vector3(k*0.10,0.21-Math.abs(k)*0.02,-0.40), end
      ]),18,0.011,6,false), m);
      P(g, new T.SphereGeometry(0.02,8,8), m, end.x, end.y, end.z);
      P(g, new T.ConeGeometry(0.018,0.12,6), mg, end.x*0.8, end.y-0.06, end.z+0.05, 0.9,0,0);
    }
    [-1,1].forEach(function(sx){ P(g, new T.CylinderGeometry(0.013,0.016,0.07,6), m, sx*0.035,0.005,0.05); });
    g.scale.setScalar(1.25);
    return g;
  }
  /* 三つ巴の紋（伝統文様） */
  function tomoe(parent, mat){
    for(var k=0;k<3;k++){
      var a0=k*Math.PI*2/3, pts=[];
      for(var i=0;i<=10;i++){ var t=i/10, a=a0+t*2.2, r=0.02+t*0.052; pts.push(new T.Vector3(Math.cos(a)*r, Math.sin(a)*r, 0.014)); }
      P(parent, new T.TubeGeometry(new T.CatmullRomCurve3(pts),16,0.009+0.0,5,false), mat);
      P(parent, new T.SphereGeometry(0.022,10,8), mat, Math.cos(a0)*0.03, Math.sin(a0)*0.03, 0.012, 0,0,0, 1,1,0.4);
    }
  }
  function giboshi(m){
    var g=new T.Group();
    P(g, new T.CylinderGeometry(0.1,0.13,0.07,14), m);
    P(g, new T.SphereGeometry(0.11,16,14), m, 0,0.14,0, 0,0,0, 1,1.15,1);
    P(g, new T.ConeGeometry(0.045,0.13,10), m, 0,0.3,0);
    return g;
  }
  function tamagaki(parent, mat){
    var hx=0.6, hz=0.44, post=new T.CylinderGeometry(0.017,0.017,0.13,6), knob=new T.SphereGeometry(0.022,8,6);
    function fence(side,n){
      var span=side<2?hx:hz;
      for(var i=0;i<n;i++){
        var t=-span+(i/(n-1))*span*2, x=side===2?hx:side===3?-hx:t, z=side===0?hz:side===1?-hz:t;
        P(parent, post, mat, x,0,z); P(parent, knob, mat, x,0.072,z);
      }
      P(parent, new T.BoxGeometry(side<2?hx*2+0.05:0.03,0.026,side<2?0.03:hz*2+0.05), mat,
        side===2?hx:side===3?-hx:0, 0.045, side===0?hz:side===1?-hz:0);
    }
    fence(0,7); fence(1,7); fence(2,5); fence(3,5);
  }
  /* 房: 結び玉＋スカート＋房糸 */
  function tassel(ropeMat, bright){
    var g=new T.Group();
    P(g, new T.SphereGeometry(0.055,12,10), ropeMat, 0,0,0, 0,0,0, 1,0.85,1);
    P(g, new T.CylinderGeometry(0.03,0.045,0.05,10), ropeMat, 0,-0.06,0);
    P(g, new T.CylinderGeometry(0.048,0.08,0.24,12,1,true), ropeMat, 0,-0.2,0);
    for(var i=0;i<9;i++){ var a=i/9*Math.PI*2; P(g, new T.CylinderGeometry(0.008,0.004,0.1,4), ropeMat, Math.cos(a)*0.06,-0.36,Math.sin(a)*0.06); }
    P(g, new T.TorusGeometry(0.045,0.012,6,14), bright, 0,-0.033,0, Math.PI/2,0,0);
    return g;
  }
  /* 瓔珞: 軒から下がる金の玉飾り。遠目にも分かるよう長め・大きめ */
  function yoraku(parent, m, hx, hz){
    hx=hx||0.62; hz=hz||0.56;
    var bead=new T.SphereGeometry(0.024,8,6), plate=new T.OctahedronGeometry(0.05);
    [[hx,hz],[-hx,hz],[hx,-hz],[-hx,-hz],[0,hz*1.1],[0,-hz*1.1],[hx*1.1,0],[-hx*1.1,0]].forEach(function(p){
      for(var i=0;i<6;i++) P(parent, bead, m, p[0], -0.045-i*0.055, p[1]);
      P(parent, plate, m, p[0], -0.4, p[1], 0,0,0, 0.7,1.2,0.7);
    });
  }
  function makuTexture(text){
    var W=512, H=160, c=G.canvas(W,H), cx=c.getContext && c.getContext('2d');
    if(cx){
      var g=cx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#5a1810'); g.addColorStop(1,'#2a0a06');
      cx.fillStyle=g; cx.fillRect(0,0,W,H);
      cx.strokeStyle='#e0b85a'; cx.lineWidth=8; cx.strokeRect(8,8,W-16,H-16);
      cx.strokeStyle='rgba(224,184,90,0.5)'; cx.lineWidth=2; cx.strokeRect(20,20,W-40,H-40);
      cx.fillStyle='#f6d98a'; cx.font='bold 76px "Hiragino Mincho ProN","Yu Mincho",serif';
      cx.textAlign='center'; cx.textBaseline='middle'; cx.fillText(text, W/2, H/2+4);
    }
    return G.toTex(c, true, false);
  }

  /* ---------- 組み立て ---------- */
  function build(opts){
    opts=opts||{};
    var vkey=C.VARIANTS[opts.variant]?opts.variant:'classic';
    var V=C.VARIANTS[vkey], sides=V.sides;
    var gold=G.mat.gold(), bright=G.mat.goldBright().clone(), black=G.mat.lacquer(), shu=G.mat.shu();
    var roofMat=roofMaterial(V.roofMat), bodyMat=bodyMaterial(V.bodyMat);
    var woodLight=G.mat.wood(), woodDark=G.mat.woodDark();
    var isShinmei=V.finial==='chigi';
    var ropeHex=opts.ropeHex||0xe0762a;
    var ropeMat=G.mat.rope(ropeHex), whiteRope=G.mat.rope(0xf1ead8);

    var root=new T.Group(); root.name='mikoshi';
    var lift=new T.Group(); root.add(lift);           /* 担がれて動く部分 */
    var stat=new T.Group(); stat.position.y=-GROUND;  /* 結合する静的な部品（v1座標） */
    var anim=new T.Group(); anim.position.y=-GROUND;  /* 揺らす部品 */

    /* --- 担ぎ棒（黒漆・金の口金・白い麻縄） --- */
    var poleG=new T.CylinderGeometry(POLE_R,POLE_R,POLE_LEN,14); poleG.rotateZ(Math.PI/2);
    [POLE_Z,-POLE_Z].forEach(function(z){
      P(stat, poleG, black, 0,POLE_Y,z);
      [-1.63,1.63].forEach(function(x){
        P(stat, new T.CylinderGeometry(0.06,0.06,0.1,14), bright, x,POLE_Y,z, 0,0,Math.PI/2);
        P(stat, new T.SphereGeometry(0.052,12,10), bright, x+(x>0?0.06:-0.06),POLE_Y,z);
      });
      [-0.72,0.72].forEach(function(x){
        for(var i=0;i<4;i++) P(stat, new T.TorusGeometry(0.064,0.015,8,14), whiteRope, x+(i-1.5)*0.032,POLE_Y,z, 0,Math.PI/2,0);
      });
    });
    [-0.72,0.72].forEach(function(x){ P(stat, new T.BoxGeometry(0.07,0.055,0.92), black, x,POLE_Y+0.055,0); });

    /* --- 台輪（二段の漆に金の帯・金鋲・四隅金具） --- */
    {
      P(stat, new T.BoxGeometry(1.52,0.17,1.16), black, 0,-0.77,0);
      P(stat, new T.BoxGeometry(1.58,0.045,1.22), gold, 0,-0.675,0);
      P(stat, new T.BoxGeometry(1.36,0.12,1.02), shu, 0,-0.595,0);
      P(stat, new T.BoxGeometry(1.4,0.035,1.06), gold, 0,-0.53,0);
      var stud=new T.SphereGeometry(0.022,8,6);
      for(var si=0;si<7;si++){
        var sx=-0.66+si*0.22;
        P(stat, stud, bright, sx,-0.77,0.585); P(stat, stud, bright, sx,-0.77,-0.585);
      }
      for(si=0;si<5;si++){ var sz=-0.44+si*0.22; P(stat, stud, bright, 0.765,-0.77,sz); P(stat, stud, bright, -0.765,-0.77,sz); }
      [[0.74,0.56],[-0.74,0.56],[0.74,-0.56],[-0.74,-0.56]].forEach(function(p){
        P(stat, new T.BoxGeometry(0.095,0.2,0.095), bright, p[0],-0.77,p[1]);
        P(stat, new T.SphereGeometry(0.03,8,6), bright, p[0],-0.655,p[1]);
      });
    }
    var fence=new T.Group(); fence.position.y=-0.47; stat.add(fence); tamagaki(fence, bright);

    /* --- 胴（社殿）: 四角柱 or 多角柱 --- */
    var bodyRot=Math.PI/2-Math.PI/sides;
    if(sides>4){
      /* 胴は台輪の上まで下ろす（以前は 4cm 浮いていた） */
      var bg=new T.CylinderGeometry(0.46,0.46,0.68,sides); bg.rotateY(bodyRot);
      P(stat, bg, bodyMat, 0,-0.17,0);
      [0.12,-0.44].forEach(function(y){ var ng=new T.CylinderGeometry(0.5,0.5,0.05,sides); ng.rotateY(bodyRot); P(stat, ng, gold, 0,y,0); });
      /* 柱は多角形の角に立てる（角の向き = π/sides + k·2π/sides）。六角では面の中央に立っていた */
      for(var pi=0;pi<sides;pi++){
        var pa=Math.PI/sides+pi*Math.PI*2/sides;
        P(stat, new T.CylinderGeometry(0.038,0.038,0.66,10), bright, Math.cos(pa)*0.46,-0.15,Math.sin(pa)*0.46);
        P(stat, new T.SphereGeometry(0.046,10,8), bright, Math.cos(pa)*0.46,0.19,Math.sin(pa)*0.46);
      }
      /* 御扉は面の中央に（面の向き = k·2π/sides。正面 +X は必ず面）。六角は全面、八角は1面おき */
      var apo=0.46*Math.cos(Math.PI/sides), faceW=2*0.46*Math.sin(Math.PI/sides);
      for(var fi0=0;fi0<sides;fi0++){
        if(sides===8 && fi0%2) continue;
        var fa=fi0*Math.PI*2/sides;
        doorPanel(stat, Math.cos(fa)*(apo+0.004),-0.17,Math.sin(fa)*(apo+0.004), Math.PI/2-fa, faceW*0.72,0.44);
      }
    } else {
      P(stat, new T.BoxGeometry(0.82,0.68,0.68), bodyMat, 0,-0.17,0);
      var nageM=isShinmei?woodDark:gold;
      P(stat, new T.BoxGeometry(0.9,0.05,0.76), nageM, 0,0.12,0);
      P(stat, new T.BoxGeometry(0.9,0.05,0.76), nageM, 0,-0.44,0);
      [[0.43,0.36],[-0.43,0.36],[0.43,-0.36],[-0.43,-0.36]].forEach(function(p){
        P(stat, new T.CylinderGeometry(0.042,0.042,0.66,12), isShinmei?woodLight:bright, p[0],-0.15,p[1]);
        P(stat, new T.SphereGeometry(0.05,10,8), isShinmei?woodDark:bright, p[0],0.19,p[1]);
      });
      if(isShinmei){
        P(stat, new T.BoxGeometry(0.4,0.48,0.02), woodDark, 0,-0.17,0.349);
        P(stat, new T.BoxGeometry(0.4,0.48,0.02), woodDark, 0,-0.17,-0.349);
      } else {
        doorPanel(stat, 0,-0.17,0.345, 0, 0.4,0.48);
        doorPanel(stat, 0,-0.17,-0.345, Math.PI, 0.4,0.48);
        doorPanel(stat, 0.415,-0.17,0, Math.PI/2, 0.36,0.48);
        doorPanel(stat, -0.415,-0.17,0, -Math.PI/2, 0.36,0.48);
      }
    }
    /* 御扉: 金の彫金板＋縁＋鐶（取っ手） */
    function doorPanel(parent, x,y,z, ry, w,h){
      var g=new T.Group(); g.position.set(x,y,z); g.rotation.y=ry; parent.add(g);
      /* 扉の金板は全扉・全神輿で同じ素材を使う（扉ごとに複製すると描画回数とテクスチャが増える） */
      P(g, new T.BoxGeometry(w,h,0.012), G.withRepeatShared(G.mat.gold(),0.8,1), 0,0,0.004);
      P(g, new T.BoxGeometry(w+0.03,0.03,0.03), black, 0,h/2,0.01);
      P(g, new T.BoxGeometry(w+0.03,0.03,0.03), black, 0,-h/2,0.01);
      P(g, new T.BoxGeometry(0.018,h,0.022), black, 0,0,0.012);
      [-1,1].forEach(function(s){
        P(g, new T.TorusGeometry(0.03,0.007,5,12), bright, s*w*0.2,-0.06,0.02);
        P(g, new T.CylinderGeometry(0.04,0.04,0.01,12), bright, s*w*0.24,h*0.2,0.014, Math.PI/2,0,0);
        P(g, new T.TorusGeometry(0.04,0.006,5,14), shu, s*w*0.24,h*0.2,0.02);
      });
    }
    /* 小さな朱の鳥居（正面の階段前） */
    if(V.roof!=='futon' && V.roof!=='chousa'){
      /* 正面＝担ぎ棒の向き(+X) */
      [-0.13,0.13].forEach(function(z){ P(stat, new T.CylinderGeometry(0.014,0.017,0.2,8), shu, 0.66,-0.435,z); });
      P(stat, new T.BoxGeometry(0.035,0.022,0.38), black, 0.66,-0.335,0);
      P(stat, new T.BoxGeometry(0.026,0.018,0.3), shu, 0.66,-0.39,0);
    }

    /* --- 屋根 --- */
    var finialY=0.945;
    if(V.roof==='curved'){
      if(sides===4){
        masugumi(stat, gold, 0.5, 0.4, 0.16);
        P(stat, new T.BoxGeometry(1.66,0.06,1.34), black, 0,0.22,0);
        P(stat, new T.BoxGeometry(1.7,0.028,1.38), bright, 0,0.258,0);
        medallionRow(stat, bright, 0.845, 0.685, 0.22);
      } else {
        var eg=new T.CylinderGeometry(0.94,0.94,0.06,sides); eg.rotateY(bodyRot); P(stat, eg, black, 0,0.22,0);
        var etg=new T.CylinderGeometry(0.97,0.97,0.028,sides); etg.rotateY(bodyRot); P(stat, etg, bright, 0,0.258,0);
      }
      var rsx=sides===4?1.0:0.92, rsz=sides===4?0.8:0.78;
      var roof=curvedRoof(stat, roofMat, sides); roof.position.y=0.24; roof.scale.set(rsx,0.95,rsz);
      roofRidges(stat, bright, sides, rsx, rsz, 0.24, 0.95, 1);
      /* 屋根の紋（正面の金の円紋） */
      if(sides===4){
        var crest=new T.Group(); crest.position.set(0.305,0.545,0); crest.rotation.set(0,Math.PI/2,0); crest.rotateX(-0.72); stat.add(crest);
        var crest2=new T.Group(); crest2.position.set(-0.305,0.545,0); crest2.rotation.set(0,-Math.PI/2,0); crest2.rotateX(-0.72); stat.add(crest2);
        P(crest2, new T.CylinderGeometry(0.1,0.1,0.02,24), bright, 0,0,0, Math.PI/2,0,0);
        P(crest2, new T.TorusGeometry(0.108,0.012,6,24), gold, 0,0,0.01);
        tomoe(crest2, gold);
        P(crest, new T.CylinderGeometry(0.1,0.1,0.02,24), bright, 0,0,0, Math.PI/2,0,0);
        P(crest, new T.TorusGeometry(0.108,0.012,6,24), gold, 0,0,0.01);
        tomoe(crest, gold);
      }
      P(stat, new T.BoxGeometry(0.34,0.09,0.26), black, 0,0.795,0);
      P(stat, new T.BoxGeometry(0.38,0.026,0.3), bright, 0,0.845,0);
      P(stat, new T.CylinderGeometry(0.085,0.115,0.09,14), gold, 0,0.9,0);
    } else if(V.roof==='gable'){
      P(stat, new T.BoxGeometry(1.5,0.06,1.1), woodDark, 0,0.22,0);
      [-1,1].forEach(function(s){
        P(stat, new T.BoxGeometry(1.78,0.05,0.92), woodDark, 0,0.74,s*0.36, s*0.66,0,0);
        P(stat, new T.BoxGeometry(1.82,0.03,0.06), bright, 0,0.485,s*0.68, s*0.66,0,0);
      });
      P(stat, new T.BoxGeometry(1.7,0.09,0.12), woodDark, 0,1.02,0);
      /* 妻壁: 屋根の両端の三角（五角形）を白木でふさぐ（以前は屋根の下が筒抜けだった） */
      var gs=new T.Shape();
      gs.moveTo(-0.62,0.25); gs.lineTo(0.62,0.25); gs.lineTo(0.62,0.5); gs.lineTo(0,0.98); gs.lineTo(-0.62,0.5); gs.lineTo(-0.62,0.25);
      var gw=new T.ExtrudeGeometry(gs, { depth:0.03, bevelEnabled:false }); gw.translate(0,0,-0.015); gw.rotateY(Math.PI/2);
      [-0.72,0.72].forEach(function(x){ P(stat, gw, woodLight, x,0,0); });
      /* 千木: 破風板が棟の上で交差して V 字に突き出す（交点は棟の高さ） */
      [-0.78,0.78].forEach(function(x){ [-1,1].forEach(function(s){ P(stat, new T.BoxGeometry(0.035,0.55,0.07), woodLight, x,1.216,s*0.088, s*0.42,0,0); }); });
      for(var ki=0;ki<4;ki++) P(stat, new T.CylinderGeometry(0.045,0.045,0.44,10), woodLight, -0.45+ki*0.3,1.1,0, Math.PI/2,0,0);
      /* 千木・勝男木の金の口金 */
      for(ki=0;ki<4;ki++){ [-0.22,0.22].forEach(function(z){ P(stat, new T.CylinderGeometry(0.048,0.048,0.03,10), bright, -0.45+ki*0.3,1.1,z, Math.PI/2,0,0); }); }
      finialY=1.3;
    } else if(V.roof==='futon' || V.roof==='chousa'){
      var ch=V.roof==='chousa';
      P(stat, new T.BoxGeometry(1.5,0.06,1.24), black, 0,0.22,0);
      P(stat, new T.BoxGeometry(1.54,0.026,1.28), bright, 0,0.258,0);
      /* 重ね布団: 上の段ほど大きく広がる（布団太鼓・ちょうさに共通の逆台形の姿）。
       * 布団は中央がふくらみ縁が締まった座布団形。縁に金の布団締め */
      var fm=clothMat(ch?0x8e1420:0xc32a1a);
      var fh=ch?0.21:0.19, fst=ch?0.165:0.15, fy0=0.34;
      for(var fi=0;fi<5;fi++){
        var fw=(ch?1.26:1.28)+fi*(ch?0.1:0.085), fd=(ch?1.04:1.06)+fi*(ch?0.085:0.075), fy=fy0+fi*fst;
        P(stat, futonGeo(fw,fh,fd), fm, 0,fy,0);
        /* 縁の締め（つまんだ縁に沿う金の細帯） */
        var ex=fw*0.525+0.004, ez=fd*0.525+0.004;   /* 側面のふくらみ（5%）の外側 */
        P(stat, new T.BoxGeometry(ex*2+0.02,0.02,0.026), bright, 0,fy,ez);
        P(stat, new T.BoxGeometry(ex*2+0.02,0.02,0.026), bright, 0,fy,-ez);
        P(stat, new T.BoxGeometry(0.026,0.02,ez*2+0.02), bright, ex,fy,0);
        P(stat, new T.BoxGeometry(0.026,0.02,ez*2+0.02), bright, -ex,fy,0);
      }
      /* 布団を支える芯柱（一番下の布団と台の間） */
      P(stat, new T.BoxGeometry(1.0,0.1,0.8), black, 0,0.29,0);
      /* ちょうさは天辺の布団のふくらみ（中央1.105）の上に十字の締めを出すため、締め・座・擬宝珠を3cm上げる */
      var topY=fy0+4*fst+fh*0.5-0.02+(ch?0.03:0);
      /* 頂上の擬宝珠をのせる金の座 */
      P(stat, new T.CylinderGeometry(0.16,0.2,0.06,14), bright, 0,topY+0.015,0);   /* 上面は従来どおり topY+0.045。下へ1cm伸ばし、ちょうさで締めの上にのせても布団との間に隙間を作らない */
      if(ch){
        /* ちょうさの布団締め: 天辺で十字に掛ける太い金の綱 */
        var cw=fw*0.62, cd=fd*0.62;
        P(stat, new T.BoxGeometry(cw,0.04,0.09), bright, 0,topY-0.005,0);
        P(stat, new T.BoxGeometry(0.09,0.04,cd), bright, 0,topY-0.005,0);
        for(var fr=0;fr<12;fr++){
          P(stat, new T.CylinderGeometry(0.012,0.008,0.18,4), bright, -0.66+fr*0.12,0.18,0.64);
          P(stat, new T.CylinderGeometry(0.012,0.008,0.18,4), bright, -0.66+fr*0.12,0.18,-0.64);
        }
      }
      finialY=topY+0.04;
    } else if(V.roof==='dashi'){
      /* 山車: 下段（胴）＋金の高欄の上に上段の屋形、反り屋根に隅棟と蕨手。地面に届く車輪 */
      P(stat, new T.BoxGeometry(1.4,0.06,1.2), black, 0,0.22,0);
      var rail=new T.Group(); rail.position.y=0.31; rail.scale.set(1.1,1,1.27); stat.add(rail); tamagaki(rail, bright);
      P(stat, new T.BoxGeometry(0.62,0.42,0.52), shu, 0,0.5,0);
      [[0.28,0.22],[-0.28,0.22],[0.28,-0.22],[-0.28,-0.22]].forEach(function(p){ P(stat, new T.CylinderGeometry(0.028,0.028,0.44,8), bright, p[0],0.5,p[1]); });
      P(stat, new T.BoxGeometry(0.8,0.04,0.68), black, 0,0.71,0);
      var ur=curvedRoof(stat, black, 4); ur.scale.set(0.62,0.6,0.5); ur.position.y=0.72;
      roofRidges(stat, bright, 4, 0.62, 0.5, 0.72, 0.6, 0.62);
      P(stat, new T.BoxGeometry(0.2,0.06,0.16), black, 0,1.07,0);
      P(stat, new T.BoxGeometry(0.24,0.02,0.2), bright, 0,1.1,0);
      P(stat, new T.BoxGeometry(0.72,0.03,0.62), gold, 0,0.31,0);
      /* 車輪: 中心は地面(-1.6)＋半径＋少し。台輪の下に車軸の枠 */
      var wheelM=G.mat.woodDark(), WR=0.32, WY=GROUND+WR+0.1;   /* 担ぎの沈み込み（最大約0.16）でも地面にめり込みにくい高さ */
      [0.56,-0.56].forEach(function(x){
        P(stat, new T.BoxGeometry(0.1,0.4,1.16), wheelM, x,(WY+(-0.855))/2,0);
        P(stat, new T.CylinderGeometry(0.03,0.03,1.5,8), black, x,WY,0, Math.PI/2,0,0);
      });
      [[0.56,0.7],[-0.56,0.7],[0.56,-0.7],[-0.56,-0.7]].forEach(function(p){
        P(stat, new T.CylinderGeometry(WR,WR,0.09,20), wheelM, p[0],WY,p[1], Math.PI/2,0,0);
        P(stat, new T.TorusGeometry(WR-0.01,0.02,6,24), black, p[0],WY,p[1]+(p[1]>0?0.047:-0.047));
        P(stat, new T.CylinderGeometry(0.07,0.07,0.11,12), bright, p[0],WY,p[1], Math.PI/2,0,0);
      });
      finialY=1.11;
    }

    /* --- 頂上飾り（揺らす） --- */
    var finial=new T.Group(); finial.position.y=finialY; anim.add(finial);
    /* 鳳凰は神輿の正面（+X＝進む向き）を向く。以前は横(+Z)を向いていた */
    if(V.finial==='phoenix'){ var ph=phoenix(bright, gold); ph.rotation.y=Math.PI/2; finial.add(ph); }
    else if(V.finial==='giboshi') finial.add(giboshi(bright));

    /* --- 飾り紐・房・鈴（揺らす） --- */
    var tassels=[];
    if(V.roof!=='futon'){
      [[0.82,0.62],[-0.82,0.62],[0.82,-0.62],[-0.82,-0.62]].forEach(function(p){
        var sx=p[0], sz=p[1];
        var pivot=new T.Group(); pivot.position.set(sx,0.3,sz*1.03); anim.add(pivot);
        var curve=new T.CatmullRomCurve3([
          new T.Vector3(0,0,0), new T.Vector3(sx*0.22,-0.48,sz*0.03), new T.Vector3(sx*0.1,-0.82,-sz*0.15)
        ]);
        P(pivot, new T.TubeGeometry(curve,20,0.03,8,false), ropeMat);
        var tas=tassel(ropeMat, bright); tas.position.set(sx*0.1,-0.86,-sz*0.15); pivot.add(tas);
        P(pivot, new T.SphereGeometry(0.045,12,10), bright, sx*0.2,-0.5,sz*0.03);
        pivot.userData.phase=Math.random()*6;
        tassels.push(pivot);
      });
    } else {
      /* 布団太鼓は四隅の大房 */
      [[0.72,0.6],[-0.72,0.6],[0.72,-0.6],[-0.72,-0.6]].forEach(function(p){
        var pivot=new T.Group(); pivot.position.set(p[0],0.3,p[1]); anim.add(pivot);
        var tas=tassel(G.mat.rope(0xf3ecda), bright); tas.scale.setScalar(1.3); tas.position.y=-0.05; pivot.add(tas);
        pivot.userData.phase=Math.random()*6;
        tassels.push(pivot);
      });
    }

    /* --- 段位の飾り（勝ち進むほど豪華に） --- */
    var level=opts.level||0, lanterns=[];
    if(level>=1){
      /* 担ぎ棒の端に提灯 */
      [[1.5,POLE_Z],[1.5,-POLE_Z],[-1.5,POLE_Z],[-1.5,-POLE_Z]].forEach(function(p){
        var pivot=new T.Group(); pivot.position.set(p[0],POLE_Y-0.05,p[1]); anim.add(pivot);
        P(pivot, new T.CylinderGeometry(0.006,0.006,0.12,4), black, 0,-0.06,0);
        var lm=G.mat.lanternPaper(opts.accent||V.accent, '祭');
        var l=P(pivot, new T.SphereGeometry(0.12,14,12), lm, 0,-0.26,0, 0,0,0, 1,1.3,1);
        P(pivot, new T.CylinderGeometry(0.06,0.06,0.03,10), black, 0,-0.105,0);
        P(pivot, new T.CylinderGeometry(0.06,0.06,0.03,10), black, 0,-0.415,0);
        var gs=G.glowSprite(0xffa050, 0.75, 1.0); gs.position.y=-0.26; pivot.add(gs);
        pivot.userData.phase=Math.random()*6;
        lanterns.push(pivot);
      });
    }
    if(level>=2 && opts.teamName){
      var mm=new T.MeshStandardMaterial({ map:makuTexture(opts.teamName), roughness:0.8, side:T.DoubleSide });
      P(stat, new T.PlaneGeometry(1.2,0.36), mm, 0,-1.04,0.6);
      P(stat, new T.PlaneGeometry(1.2,0.36), mm, 0,-1.04,-0.6, 0,Math.PI,0);
      P(stat, new T.CylinderGeometry(0.012,0.012,1.26,6), bright, 0,-0.86,0.6, 0,0,Math.PI/2);
      P(stat, new T.CylinderGeometry(0.012,0.012,1.26,6), bright, 0,-0.86,-0.6, 0,0,Math.PI/2);
    }
    if(level>=3){
      /* 瓔珞は軒先の内側から下げる（屋根の形ごとに軒の大きさが違う） */
      var yo=new T.Group(); yo.position.y=0.3; stat.add(yo);
      if(V.roof==='dashi'){ yo.position.y=0.21; yoraku(yo, bright, 0.6, 0.5); }
      else if(V.roof==='gable') yoraku(yo, bright, 0.66, 0.5);
      else yoraku(yo, bright, 0.62, 0.52);
      /* 軒下の金の輪は反り屋根だけ（ほかの屋根では宙に浮くため） */
      if(V.roof==='curved') P(stat, new T.TorusGeometry(0.95,0.026,8,40), bright, 0,0.3,0, Math.PI/2,0,0, 1,0.82,1);
    }
    if(level>=4){
      /* 最上位（伍）: 頂上の飾りに金の後光。勢いで輝く金と合わせて遠目にも格が分かる */
      var halo=G.glowSprite(0xffc860, 1.5, 0.55); halo.position.y=0.3; finial.add(halo);
    }

    /* 結合して描画回数を減らす（揺らす部品も部品ごとに結合） */
    G.mergeInPlace(finial);
    tassels.forEach(function(p){ G.mergeInPlace(p); });
    lanterns.forEach(function(p){ G.mergeInPlace(p); });
    var merged=G.mergeGroup(stat, { castShadow:true });
    merged.position.y=-GROUND;
    lift.add(merged);
    lift.add(anim);

    var energy=0, glowBase=bright.emissiveIntensity;
    return {
      root:root, lift:lift, finial:finial, tassels:tassels, lanterns:lanterns,
      variant:vkey, level:level,
      poleY:POLE_Y-GROUND, poleZ:POLE_Z, halfLen:POLE_LEN/2+0.1, poleLen:POLE_LEN,
      /* motion: {vy: 上下の速さ, tilt: 傾き} を渡すと房が遅れて揺れる */
      update:function(dt, t, motion){
        motion=motion||{};
        var jolt=(motion.jolt||0);
        tassels.forEach(function(p){
          var ph=p.userData.phase;
          var target=Math.sin(t*2.2+ph)*0.08 + jolt*0.5 + (motion.lean||0)*0.6;
          p.userData.v=(p.userData.v||0)+((target-(p.rotation.x||0))*28 - (p.userData.v||0)*4.5)*dt;
          p.rotation.x+=p.userData.v*dt;
          p.rotation.z=Math.sin(t*1.7+ph)*0.06 - (motion.roll||0)*0.8;
        });
        lanterns.forEach(function(p){
          var ph=p.userData.phase;
          p.rotation.x=Math.sin(t*2.6+ph)*0.12+jolt*0.4+(motion.lean||0)*0.5;
          p.rotation.z=Math.sin(t*2.1+ph)*0.1;
        });
        finial.rotation.z=Math.sin(t*1.3)*0.015-(motion.roll||0)*0.3;
        finial.rotation.x=jolt*0.08;
      },
      /* 勢い（0〜1）で金を輝かせる */
      setEnergy:function(e){
        energy=e;
        bright.emissiveIntensity=glowBase+e*1.4;
      }
    };
  }

  MK.mikoshi = { build:build };
})();
