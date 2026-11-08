/* せーの！神輿バトル v2 — 舞台（シーン・カメラ・演出）
 * 会場は1回だけ作って使い回し、場面（title / match / viewer）ごとに登場人物とカメラを差し替える。
 * 試合（arena）:
 *   ・自分の連(A)は手前(-Z)、相手の連(B)は奥(+Z)。担ぎ棒は進行方向(Z)に向く
 *   ・担ぎ手は「実際にタップした瞬間」に神輿を突き上げる → 揃えば真っ直ぐ跳ね、ばらけると傾いて揺れる
 *   ・拍ごとの点数差で押し合い、「せー・の・！」で激突、判定が届くまで鍔迫り合い → 勝った側が押し込む
 *   ・決着: 負けた神輿は押し出され、勝った連は差し上げ（頭上に掲げる）＋紙吹雪＋花火 */
(function(){
  'use strict';
  var MK = window.MK = window.MK || {};
  var G = MK.gfx, U = MK.util, C = MK.C, A = MK.audio;
  var T = window.THREE;
  if(!T){ /* 3Dの部品が読み込めない環境（オフライン等）でも画面は動かす */
    MK.stage={ ready:false, mode:'off', init:function(){ return false; }, stop:function(){}, showTitle:function(){ return false; },
      showMatch:function(){ return null; }, showViewer:function(){ return null; }, clock:function(){ return 0; }, selfTest:function(){ return []; } };
    return;
  }

  var S = MK.stage = {
    ready:false, mode:'off', timeScale:1, slowmo:0,
    scene:null, camera:null, venue:null, arena:null, title:null, viewer:null
  };
  var canvasEl=null, raf=null, last=0, clock=0;
  var camState={ pos:new T.Vector3(0,3,-10), look:new T.Vector3(0,1,0), fov:50, shake:0, handheld:1 };
  var camTarget={ pos:new T.Vector3(0,3,-10), look:new T.Vector3(0,1,0), fov:50, lambda:3 };
  var fxLayer={ spark:null, dust:null, confetti:null, embers:null };

  S.init = function(el){
    if(S.ready) return true;
    canvasEl=el;
    if(!G.init(el)) return false;
    var scene=S.scene=G.setupScene(new T.Scene());
    var cam=S.camera=new T.PerspectiveCamera(50, 1, 0.1, 200);
    cam.position.copy(camState.pos);
    /* 光: 空の青紫と地面の照り返し・左後ろからの月明かり（影）・奥の夕陽の縁取り・右の補助光 */
    scene.add(new T.HemisphereLight(0x8a86d0, 0x3a2418, 0.45));
    var key=S.keyLight=new T.DirectionalLight(0xffe2c0, 2.1);
    key.position.set(-6,10,-8); key.castShadow=true;
    key.shadow.mapSize.set(G.isMobile?1024:2048, G.isMobile?1024:2048);
    var sc=key.shadow.camera; sc.left=-7; sc.right=7; sc.top=7; sc.bottom=-7; sc.near=1; sc.far=30;
    key.shadow.bias=-0.0006; key.shadow.normalBias=0.02;
    scene.add(key); scene.add(key.target);
    var rim=new T.DirectionalLight(0xff9a50, 2.2); rim.position.set(5,4,16); scene.add(rim);
    var fill=new T.DirectionalLight(0x7a70d0, 0.6); fill.position.set(7,3,-5); scene.add(fill);
    S.venue=MK.venue.build(scene);
    /* 演出用の粒子 */
    fxLayer.spark=new G.Particles(420, G.tex.glow(), true);
    fxLayer.embers=new G.Particles(260, G.tex.glow(), true);
    fxLayer.dust=new G.Particles(220, G.tex.glow(), false);
    fxLayer.confetti=new G.Particles(600, G.tex.square(), false);
    fxLayer.petals=new G.Particles(200, G.tex.petal(), false);
    Object.keys(fxLayer).forEach(function(k){ scene.add(fxLayer[k].points); });
    S.fx=fxLayer;
    S.ready=true;
    return true;
  };

  function loop(now){
    raf=requestAnimationFrame(loop);
    var real=Math.min(0.05, Math.max(0, (now-last)/1000)); last=now;
    frame(real);
  }
  /* 1コマ進める（確認用に外からも呼べる） */
  S.step=function(real, n){ for(var i=0;i<(n||1);i++) frame(real||1/60); };
  function frame(real){
    S.slowmo=MK.reduceMotion?0:Math.max(0, S.slowmo-real);
    var dt=real*(S.slowmo>0?0.28:1)*S.timeScale;
    clock+=dt;
    if(S.venue) S.venue.update(dt, clock);
    if(S.mode==='match' && S.arena) S.arena.update(dt, clock, real);
    else if(S.mode==='title' && S.title) S.title.update(dt, clock);
    else if(S.mode==='viewer' && S.viewer) S.viewer.update(dt, clock);
    updateCamera(real, dt);
    G.updateParticles(dt);
    G.updateFx(real);
    G.render(S.scene, S.camera);
    if(real>0 && real<0.2) G.adapt(real);
  }
  function start(){
    if(raf) return;
    canvasEl.classList.add('show');
    last=performance.now();
    raf=requestAnimationFrame(loop);
  }
  S.stop = function(){
    if(raf){ cancelAnimationFrame(raf); raf=null; }
    if(canvasEl) canvasEl.classList.remove('show');
    S.mode='off';
  };
  S.setCamera = function(pos, look, fov, lambda, snap){
    camTarget.pos.copy(pos); camTarget.look.copy(look);
    camTarget.fov=fov||50; camTarget.lambda=lambda||3;
    if(snap){ camState.pos.copy(pos); camState.look.copy(look); camState.fov=camTarget.fov; }
  };
  S.shake = function(amount){ if(MK.reduceMotion) return; camState.shake=Math.max(camState.shake, amount); };
  function updateCamera(real, dt){
    var l=camTarget.lambda;
    camState.pos.x=U.damp(camState.pos.x, camTarget.pos.x, l, real);
    camState.pos.y=U.damp(camState.pos.y, camTarget.pos.y, l, real);
    camState.pos.z=U.damp(camState.pos.z, camTarget.pos.z, l, real);
    camState.look.x=U.damp(camState.look.x, camTarget.look.x, l*1.3, real);
    camState.look.y=U.damp(camState.look.y, camTarget.look.y, l*1.3, real);
    camState.look.z=U.damp(camState.look.z, camTarget.look.z, l*1.3, real);
    camState.fov=U.damp(camState.fov, camTarget.fov, 4, real);
    camState.shake=Math.max(0, camState.shake-real*1.8);
    var cam=S.camera, t=clock;
    /* 手持ちカメラの微かな揺れ＋衝撃の揺れ */
    var hh=MK.reduceMotion?0:0.012*camState.handheld, sh=camState.shake*camState.shake*0.22;
    cam.position.set(
      camState.pos.x+Math.sin(t*0.9)*hh+Math.sin(t*1.7)*hh*0.5+(Math.random()-0.5)*sh,
      camState.pos.y+Math.sin(t*1.3+1)*hh+(Math.random()-0.5)*sh,
      camState.pos.z+Math.cos(t*0.7)*hh*0.6);
    cam.lookAt(camState.look.x+(Math.random()-0.5)*sh*0.4, camState.look.y+(Math.random()-0.5)*sh*0.4, camState.look.z);
    if(Math.abs(cam.fov-camState.fov)>0.01){ cam.fov=camState.fov; cam.updateProjectionMatrix(); }
  }
  function clearActors(){
    ['arena','title','viewer'].forEach(function(k){ if(S[k]){ S[k].dispose(); S[k]=null; } });
    Object.keys(fxLayer).forEach(function(k){ fxLayer[k] && fxLayer[k].clear(); });
    G.fxState.fade=0; G.fxState.flash=0;
    S.slowmo=0; camState.shake=0;
  }
  /* 使い回しの計算用（毎コマの new を避ける） */
  var _q=new T.Quaternion(), _one=new T.Vector3(1,1,1), _p=new T.Vector3(), _col=new T.Color(), _inv=new T.Matrix4(),
      _grip=new T.Vector3(), _cp=new T.Vector3(), _cl=new T.Vector3();
  /* 担ぎ手の足元の砂煙（小さめ。power 0〜1） */
  function footDust(x, z, n, power){
    var ps=fxLayer.dust; if(!ps) return;
    for(var i=0;i<n;i++){
      var a=Math.random()*Math.PI*2, sp=(0.3+Math.random()*0.6)*(0.6+power*0.6);
      ps.emit({ x:x+(Math.random()-0.5)*0.22, y:0.05, z:z+(Math.random()-0.5)*0.22,
        vx:Math.cos(a)*sp, vy:0.15+Math.random()*0.35*(0.5+power), vz:Math.sin(a)*sp,
        life:0.55+Math.random()*0.5, size:0.1, sizeEnd:0.3+0.25*power, drag:3, grav:-0.05,
        color:[0.62,0.54,0.5,0.2+0.1*power] });
    }
  }

  /* ================= 担ぎ手つきの神輿（連） ================= */
  /* 担ぎ手の位置（神輿から見て [担ぎ棒の前後, 左右]）。
   * 人間は「カメラ側・前寄り」（試合中の画面の中央付近で、ぶつかる相手に近い位置）から先に並べる */
  var SLOTS=[[1.0,-1],[1.42,-1],[1.0,1],[1.42,1],[-1.0,-1],[-1.42,-1],[-1.0,1],[-1.42,1]];
  function Team(o){
    var self=this;
    this.dir=o.dir;                     /* +1: +Zへ向かう(自分) / -1: -Zへ向かう(相手) */
    this.group=new T.Group();
    this.group.rotation.y=o.dir>0?-Math.PI/2:Math.PI/2;
    this.mk=MK.mikoshi.build({ variant:o.variant, teamName:o.name, level:o.level||0, accent:o.accent });
    this.group.add(this.mk.root);
    this.outfit=o.outfit||MK.avatar.teamOutfit(o.name, o.variant);
    this.carriers=[];
    this.idToSlot={};
    var members=o.members||[];
    var order=[];
    if(o.selfIndex!==undefined && o.selfIndex>=0) order.push(o.selfIndex);
    for(var i=0;i<members.length;i++) if(i!==o.selfIndex) order.push(i);
    for(var s=0;s<SLOTS.length;s++){
      var slot=SLOTS[s], side=slot[1];
      var mi=order[s], member=mi!==undefined?members[mi]:null;
      var look=MK.avatar.randomLook(U.hash((o.name||'')+s)+(member?U.hash(member.name||''):0));
      var isSelf=o.selfIndex!==undefined && mi===o.selfIndex;
      var outfit=this.outfit;
      var av=MK.avatar.build(outfit, look);
      if(isSelf && o.selfItems){ o.selfItems.forEach(function(it){ MK.avatar.equip(av, it); }); }
      av.root.position.set(slot[0], 0, side*(this.mk.poleZ+0.145));
      av.root.rotation.y=Math.PI/2;
      this.group.add(av.root);
      var c={ av:av, slot:s, side:side, x:slot[0], z:side*(this.mk.poleZ+0.145), tapT:-99, punchT:-99, heave:0, hv:0,
        isSelf:isSelf, stepPh:Math.random()*6, stagger:0, cheer:0, sag:0, lean:0 };
      this.carriers.push(c);
      if(member) this.idToSlot[member.pid]=s;
    }
    /* 助っ人CPU（'b0','b1'…）は人間の後ろの枠に入る */
    var humans=Math.min(members.length, SLOTS.length);
    for(var b=0;b<16;b++) this.idToSlot['b'+b]=(humans+b)%SLOTS.length;
    for(var e=0;e<16;e++) this.idToSlot['e'+e]=e%SLOTS.length;
    this.selfCarrier=this.carriers.filter(function(c){ return c.isSelf; })[0]||null;
    /* 状態 */
    this.z=0; this.zVel=0; this.lift=0; this.liftVel=0; this.roll=0; this.pitch=0; this.jolt=0;
    this.energy=0; this.pending=[]; this.crouchBias=0; this.leanAll=0; this.raise=0; this.sag=0; this.cheer=0;
    this.walk=0; this.stagger=0;
    /* 揃いと勢いの見た目: coh=いま同時に突き上げている度合い / tier=勢いの段（0〜3）/ wobble=ばらけた後のぐらつき */
    this.coh=0; this.combo=0; this.tier=0; this.wobble=0; this.wobDir=1; this.pulse=0; this.dustLv=0; this.stomp=0;
    this.emberAcc=0; this.retreat=0; this.mood=null; this.moodUntil=0; this.shoutAll=0;
    /* 担ぎ手の足元の影（まとめて1回で描く） */
    var sg=new T.PlaneGeometry(0.42,0.42); sg.rotateX(-Math.PI/2);
    this.shadows=new T.InstancedMesh(sg, G.blobShadowMat(), SLOTS.length);
    this.shadows.renderOrder=1;
    this.shadowM=new T.Matrix4();
  }
  Team.prototype.addTo=function(scene){ scene.add(this.group); scene.add(this.shadows); };
  Team.prototype.removeFrom=function(scene){
    scene.remove(this.group); scene.remove(this.shadows);
    G.disposeTree(this.group); G.disposeTree(this.shadows);
  };
  /* id（pid / 'b3' / 'e2'）の担ぎ手が perfTime に叩いた */
  Team.prototype.scheduleTap=function(id, perfTime){
    var slot=this.idToSlot[id]; if(slot===undefined) return;
    this.pending.push({ slot:slot, t:perfTime });
  };
  Team.prototype.tapNow=function(slot){
    var c=this.carriers[slot]; if(!c) return;
    c.tapT=clock; c.punchT=clock;
  };
  Team.prototype.update=function(dt, t, rhythm){
    var nowP=performance.now();
    for(var i=this.pending.length-1;i>=0;i--){
      if(this.pending[i].t<=nowP){ this.tapNow(this.pending[i].slot); this.pending.splice(i,1); }
    }
    /* 拍の予感: 拍の直前にしゃがみ込む。太鼓が鳴っている間は拍に合わせて足踏み（拍で足が着く） */
    var ant=0.18, beatStep=null;
    if(rhythm && rhythm.active){
      var ph=rhythm.phase; /* 0..1、1で拍 */
      ant=0.22+0.38*Math.pow(Math.max(0,(ph-0.45)/0.55),2);
      if(rhythm.beatF!==undefined && isFinite(rhythm.beatF)) beatStep=rhythm.beatF*Math.PI;
    }
    if(this.moodUntil && t>this.moodUntil){ this.mood=null; this.moodUntil=0; }
    var sumH=0, sumL=0, sumR=0, sumF=0, sumB=0, nL=0, nR=0, nF=0, nB=0;
    var self=this, mk=this.mk, rm=MK.reduceMotion;
    mk.lift.updateMatrix();
    this.carriers.forEach(function(c, idx){
      var since=t-c.tapT;
      var h=since>=0&&since<0.42 ? Math.sin(Math.min(1,since/0.1)*Math.PI*0.5)*Math.exp(-Math.max(0,since-0.1)*7) : 0;
      c.heave=h;
      var pSince=t-c.punchT;
      var punch=pSince>=0&&pSince<0.55 ? Math.sin(Math.min(1,pSince/0.09)*Math.PI*0.5)*Math.exp(-Math.max(0,pSince-0.12)*5) : 0;
      sumH+=h;
      if(c.side>0){ sumL+=h; nL++; } else { sumR+=h; nR++; }
      if(c.x>0){ sumF+=h; nF++; } else { sumB+=h; nB++; }
      var stepAmt=0, step;
      c.stepPh+=dt*(4+Math.abs(self.walk)*8);
      if(Math.abs(self.walk)>0.02){ stepAmt=Math.min(1, Math.abs(self.walk)*1.6); step=c.stepPh+idx; }
      else if(beatStep!==null){ stepAmt=0.22; step=beatStep; }
      else step=c.stepPh+idx;
      c.stagger=U.damp(c.stagger||0, 0, 1.6, dt);
      /* 表情: 普段／掛け声（突き上げた瞬間・揃っている間）／喜び／悔しい */
      var face;
      if(self.mood==='sad') face='sad';
      else if(self.mood==='joy') face=(punch>0.3||self.raise>0.6)?'shout':'joy';
      else face=(punch>0.3 || self.raise>0.4 || self.shoutAll>0 || (h>0.15 && self.tier>=1))?'shout':'calm';
      /* 差し上げ: 腕を伸ばして持ち上げる時は体ごと少し伸び上がる。揃って突き上げるほど背伸びする */
      c.av.root.position.y=h*0.018*(0.6+self.coh)+self.raise*0.07;
      /* 担ぎ棒の位置（この担ぎ手の座標）: 神輿の上下・傾きに内側の手がついていく */
      _grip.set(c.x, mk.poleY, c.side*mk.poleZ).applyMatrix4(mk.lift.matrix);
      c.av.root.updateMatrix();
      _grip.applyMatrix4(_inv.copy(c.av.root.matrix).invert());
      c.av.pose({
        carry:1, side:c.side, heave:h, punch:Math.max(punch, self.cheer*0.9), crouch:ant+self.crouchBias - self.raise*0.6,
        lean:self.leanAll+c.stagger, stepAmt:stepAmt, step:step, cheer:Math.min(1,self.raise*1.4), sag:self.sag,
        roll:self.stagger*Math.sin(t*(rm?6:17)+idx)*(rm?0.12:0.3), shout:face==='shout'?1:0, face:face, look:0, grip:_grip
      });
      if(c.av.rainbowBand){ c.av.tint('band', _col.setHSL((t*0.25)%1,0.85,0.55)); }
    });
    var n=this.carriers.length, avg=n?sumH/n:0;
    this.coh=avg;
    /* 神輿の動き: 揃って同時に突き上げるほど高く跳ね（2乗で効く）、左右・前後の差で傾く（ばねで重さを出す）。
     * ばらけた拍の後（wobble）は片側へぐらっと傾いたまま揺れる。溜め（crouchBias）では沈む */
    var sashi=Math.min(1,this.raise);   /* 差し上げ中は腕の届く高さに収める（手が棒から離れない） */
    var targetLift=(avg*0.06+avg*avg*0.15)*(1-0.7*sashi)+this.raise*0.24-this.sag*0.06-this.crouchBias*0.1;
    this.liftVel+=((targetLift-this.lift)*120-this.liftVel*14)*dt;
    this.lift+=this.liftVel*dt;
    this.wobble=Math.max(0, this.wobble-dt*0.8);
    var targetRoll=((nL?sumL/nL:0)-(nR?sumR/nR:0))*0.24 + this.wobble*this.wobDir*0.075*(0.65+0.35*Math.sin(t*5.2))
      + (rm?0:this.stagger*Math.sin(t*9)*0.08);
    var targetPitch=((nF?sumF/nF:0)-(nB?sumB/nB:0))*0.15-this.leanAll*0.05 + this.wobble*0.035*Math.sin(t*3.7+1);
    this.roll=U.damp(this.roll, targetRoll, 10, dt);
    this.pitch=U.damp(this.pitch, targetPitch, 10, dt);
    this.jolt=U.damp(this.jolt, 0, 5, dt);
    this.pulse=Math.max(0, this.pulse-dt*2.2);
    mk.lift.position.y=this.lift;
    mk.lift.rotation.x=this.roll;
    mk.lift.rotation.z=this.pitch;
    mk.update(dt, t, { jolt:this.jolt+this.liftVel*0.04, lean:this.leanAll*0.3, roll:this.roll });
    mk.setEnergy(Math.min(1.6, this.energy+this.pulse*0.6));
    /* 勢いの段: 3以上で神輿のまわりに火の粉、6（最大）で火の粉が増え金が最も輝く */
    if(this.tier>=2){
      this.emberAcc+=dt*(this.tier>=3?14:3+Math.max(0,this.combo-3)*2);
      while(this.emberAcc>=1){ this.emberAcc-=1; G.fx.embers(fxLayer.embers, (Math.random()-0.5)*1.3, 0.85+Math.random()*0.6, this.z+(Math.random()-0.5)*2.6, 1, 0.2); }
    } else this.emberAcc=0;
    /* 位置 */
    this.group.position.z=this.z;
    /* 揃って踏み込んだ瞬間の砂煙（揃うほど多い）。「の」の踏み込みでも出す */
    var dustN=0;
    if(avg<0.3) this.dustLv=0;
    else if(avg>0.78 && this.dustLv<2){ dustN=this.dustLv===1?2:3; this.dustLv=2; }
    else if(avg>0.5 && this.dustLv<1){ dustN=1; this.dustLv=1; }
    var dustPow=this.dustLv>=2?1:0.4;
    if(this.stomp){ dustN=Math.max(dustN,3); dustPow=1; this.stomp=0; }
    /* 足元の影 */
    var m=this.shadowM, p=_p;
    this.group.updateMatrixWorld(true);
    for(var i2=0;i2<n;i2++){
      var cc=this.carriers[i2];
      p.set(0,0,0); cc.av.root.localToWorld(p); p.y=0.025;
      m.compose(p, _q, _one); this.shadows.setMatrixAt(i2, m);
      if(dustN) footDust(p.x, p.z, dustN, dustPow);
    }
    this.shadows.instanceMatrix.needsUpdate=true;
  };
  /* 拍の結果から: 揃い（点）と勢い（combo）を連の様子に反映する。
   * 結果が届くのは次の拍のころなので、跳ねる動きそのものは実際のタップで出し、ここでは「状態」だけを変える */
  Team.prototype.setMomentum=function(pts, combo, sync){
    combo=combo||0;
    var MAX=C.MOMENTUM_MAX||6;
    var full=(C.BEAT_PTS||10)*(1+Math.min(combo,MAX)*0.08);
    var q=(sync!==undefined && sync!==null && isFinite(sync))?U.clamp(+sync,0,1):U.clamp((+pts||0)/full, 0, 1);
    var prevTier=this.tier;
    this.combo=combo;
    this.tier=combo>=MAX?3:(combo>=3?2:(combo>=1?1:0));
    this.energy=this.tier===3?1:(this.tier===2?0.5+(combo-3)*0.1:combo*0.15);
    if(combo>0){ this.wobble=0; }
    else { this.wobble=0.45+0.55*(1-q); this.wobDir=Math.random()<0.5?-1:1; }
    if(this.tier>prevTier && this.tier>=2){
      this.pulse=1;
      if(this.tier===3){
        G.fx.ring(fxLayer.spark, 0, 1.35, this.z, 0.9, [3.2,2.5,1.1,1], 40);
        G.fx.embers(fxLayer.embers, 0, 1.2, this.z, 16, 1.6);
      } else G.fx.embers(fxLayer.embers, 0, 1.2, this.z, 10, 1.4);
    }
  };
  Team.prototype.frontZ=function(){ return this.z+this.dir*this.mk.halfLen; };
  Team.prototype.dispose=function(){};

  /* ================= 試合 ================= */
  function Arena(opts){
    var self=this;
    this.opts=opts;
    var outA=MK.avatar.teamOutfit(opts.you.name, opts.you.variant);
    var outB=MK.avatar.teamOutfit(opts.enemy.name, opts.enemy.variant, outA.happi);
    this.A=new Team({ dir:1, name:opts.you.name, variant:opts.you.variant, level:opts.you.level, members:opts.you.members,
      selfIndex:opts.you.selfIndex, selfItems:opts.you.selfItems, accent:0xd8392a, outfit:outA });
    this.B=new Team({ dir:-1, name:opts.enemy.name, variant:opts.enemy.variant, level:opts.enemy.level, members:opts.enemy.members||[], accent:0x3a7ad8, outfit:outB });
    this.A.addTo(S.scene); this.B.addTo(S.scene);
    this.push=0; this.pushTarget=0; this.pushVel=0;
    this.phase='intro'; this.phaseT=0;
    this.rhythm={ active:false, beatMs:600, origin:0, phase:0 };
    this.clash=null;
    this.baseGap=2.05;
    this.place(true);
    this.introT=0;
    this.cam='intro';
    S.venue.setHype(0.2);
    S.venue.fireworkRate=0.06;
  }
  Arena.prototype.place=function(snap){
    var p=this.push*0.9;
    var zA=-this.baseGap+p, zB=this.baseGap+p;
    if(snap){ this.A.z=zA; this.B.z=zB; }
    return { zA:zA, zB:zB };
  };
  /* 拍の時計（拍の時刻を perf 時間で渡す） */
  Arena.prototype.setRhythm=function(active, originPerf, beatMs){
    this.rhythm.active=active; if(originPerf!==undefined) this.rhythm.origin=originPerf; if(beatMs) this.rhythm.beatMs=beatMs;
  };
  Arena.prototype.setPush=function(p){ this.pushTarget=U.clamp(p,-1,1); };
  /* 拍の結果: 点の多い側が一歩押し込む。揃い（点）と勢い（combo）は連の様子に残す */
  /* youSync/enemySync（0〜1・省略可）: サーバーの揃い率。渡されなければ点数から見積もる */
  Arena.prototype.beatResult=function(youPts, enemyPts, youCombo, enemyCombo, youSync, enemySync){
    youPts=+youPts||0; enemyPts=+enemyPts||0; youCombo=youCombo||0; enemyCombo=enemyCombo||0;
    var d=youPts-enemyPts;
    this.pushVel+=U.clamp(d,-6,6)*0.05;
    if(d!==0){ var win=d>0?this.A:this.B, lose=d>0?this.B:this.A; win.jolt+=0.3; lose.jolt-=0.15; }
    this.A.setMomentum(youPts, youCombo, youSync); this.B.setMomentum(enemyPts, enemyCombo, enemySync);
    S.venue.setHype(0.3+Math.min(0.7, Math.abs(this.push)*0.8+Math.max(youCombo,enemyCombo)*0.05));
  };
  /* 「せー」「の」「！」の演出 */
  Arena.prototype.clashCue=function(stage){
    if(stage==='se'){
      this.phase='windup'; this.phaseT=0;
      this.cam='clash'; this.lockMid=undefined; this.curMid=undefined;
      [this.A,this.B].forEach(function(tm){ tm.mood=null; tm.moodUntil=0; });
    } else if(stage==='no'){
      this.phase='lean'; this.phaseT=0;
      this.A.stomp=1; this.B.stomp=1; this.A.jolt+=0.4; this.B.jolt+=0.4;   /* 踏み込み */
    } else if(stage==='go'){
      this.phase='charge'; this.phaseT=0;
      this.clash={ contact:false, locked:true, resolved:false };
    }
  };
  /* 判定が届いた: winSide 'A'|'B'、strength 0〜1（ぶつけの点差） */
  Arena.prototype.clashResult=function(winSide, strength, judgementA){
    strength=U.clamp(+strength||0, 0, 1);
    var sg=winSide==='A'?1:-1, win=sg>0?this.A:this.B, lose=sg>0?this.B:this.A, rm=MK.reduceMotion;
    if(!this.clash) this.clash={ contact:false, locked:true };
    var cl=this.clash;
    cl.resolved=true; cl.win=winSide; cl.strength=strength;
    /* 押し込む距離は判定の差に比例。負けた側は担ぎ手がよろけて数歩下がる（揺れ・閃光が無くても位置で分かる） */
    this.shoveDist=0.3+strength*1.1;
    /* 突進中（ぶつかる前）に届いたときは、後退をぶつかった瞬間まで取っておく（突進の途中で負けた側が瞬間移動しないように） */
    var rt=0.25+strength*0.55;
    if(this.phase==='charge' && !cl.contact){ cl.pendLose=lose; cl.pendRetreat=rt; }
    else lose.retreat=rt;
    lose.stagger=1; win.jolt+=1; lose.jolt-=0.6;
    lose.carriers.forEach(function(c){ c.stagger=-(0.35+Math.random()*0.45); });
    win.mood='joy'; win.moodUntil=clock+2.4; lose.mood='sad'; lose.moodUntil=clock+2.4;
    this.pushVel+=sg*(0.3+strength*0.5);
    /* 激突の前に判定が届いたときは、激突の瞬間に押し込みへ移る（charge の中で切り替え） */
    if(!(this.phase==='charge' && !cl.contact)){
      if(!cl.contact || this.lockMid===undefined){ cl.contact=true; this.lockMid=(this.A.frontZ()+this.B.frontZ())/2; }
      this.phase='resolve'; this.phaseT=0;
    }
    var cz=this.curMid!==undefined?this.curMid:(this.lockMid!==undefined?this.lockMid:(this.A.frontZ()+this.B.frontZ())/2);
    G.fx.sparks(fxLayer.spark, 0.3, 1.3, cz, Math.round((40+strength*50)*(rm?0.4:1)), 1.2);
    G.fx.ring(fxLayer.spark, 0.3, 1.3, cz, 0.6, winSide==='A'?[3,2.2,1,1]:[1.6,2,3.2,1], 36);
    G.fx.dust(fxLayer.dust, 0, 0, cz+sg*0.9, 6+Math.round(strength*8), 1.8);
    S.shake(0.6+strength*0.5);
    if(!rm){ G.fxState.flash=0.35; G.fxState.impact=1; }
    if(A.ready()) A.impact(0, 0.7+strength*0.5);
    S.venue.cheer(1);
    if(winSide==='A' && (judgementA==='MIRACLE'||judgementA==='PERFECT')) G.fx.confetti(fxLayer.confetti, 0, 2.5, this.A.z, 60, 3);
  };
  /* 決着 */
  Arena.prototype.finale=function(youWin){
    this.phase='finale'; this.phaseT=0; this.youWin=youWin;
    this.cam='finale';
    var win=youWin?this.A:this.B, lose=youWin?this.B:this.A;
    this.pushTarget=youWin?1.9:-1.9;
    win.walk=1; lose.walk=1;
    win.mood='joy'; win.moodUntil=0; lose.mood='sad'; lose.moodUntil=0;
    lose.tier=0; lose.combo=0; lose.energy=Math.min(lose.energy, 0.2);
    lose.carriers.forEach(function(c){ c.stagger=-(0.3+Math.random()*0.4); });
    S.venue.setHype(1); S.venue.fireworkRate=1.4;
  };
  Arena.prototype.update=function(dt, t, real){
    var A1=this.A, B1=this.B, r=this.rhythm, rm=MK.reduceMotion;
    if(r.active){
      var sinceMs=performance.now()-r.origin;
      var bp=sinceMs/r.beatMs;
      r.phase=bp-Math.floor(bp); r.beatF=bp;
    }
    this.phaseT+=dt;
    /* 押し合い（ばね） */
    this.pushVel+=((this.pushTarget-this.push)*9-this.pushVel*5)*dt;
    this.push+=this.pushVel*dt;
    var pos=this.place(false);
    var ph=this.phase, pt=this.phaseT, snap=false;
    /* 負けてよろけた分の後退（押し込み中は保ち、その後ゆっくり戻る） */
    if(ph!=='resolve'){ A1.retreat=U.damp(A1.retreat,0,0.9,dt); B1.retreat=U.damp(B1.retreat,0,0.9,dt); }
    var zA=pos.zA-A1.dir*A1.retreat, zB=pos.zB-B1.dir*B1.retreat;
    A1.crouchBias=0; B1.crouchBias=0; A1.leanAll=0; B1.leanAll=0; A1.shoutAll=0; B1.shoutAll=0;
    if(ph!=='resolve'){ A1.cheer=U.damp(A1.cheer,0,6,dt); B1.cheer=U.damp(B1.cheer,0,6,dt); }
    if(ph==='intro'){
      A1.walk=U.damp(A1.walk,0.5,2,dt); B1.walk=U.damp(B1.walk,-0.5,2,dt);
      zA-=Math.max(0,1.2-pt*0.6); zB+=Math.max(0,1.2-pt*0.6);
      if(pt>2.2){ A1.walk=0; B1.walk=0; }
    } else if(ph==='windup'){
      /* せー: 互いに半歩下がり、腰を落として溜める（神輿も沈む） */
      var w=U.easeOutCubic(Math.min(1,pt/0.35));
      zA-=0.4*w; zB+=0.4*w; A1.crouchBias=0.4*w; B1.crouchBias=0.4*w;
      A1.leanAll=-0.3*w; B1.leanAll=-0.3*w;
    } else if(ph==='lean'){
      /* の: 踏み込んで前のめりに構える（掛け声の顔） */
      var l=U.easeInOutCubic(Math.min(1,pt/0.35));
      zA-=0.4*(1-l*0.45); zB+=0.4*(1-l*0.45); A1.crouchBias=0.4+0.1*l; B1.crouchBias=0.4+0.1*l;
      A1.leanAll=U.lerp(-0.3,0.95,l); B1.leanAll=U.lerp(-0.3,0.95,l);
      A1.shoutAll=1; B1.shoutAll=1;
    } else if(ph==='charge'){
      /* ！: 突進して激突 */
      var c=Math.min(1, pt/0.16), mid=(zA+zB)/2;
      var contactA=mid-A1.mk.halfLen+0.02, contactB=mid+B1.mk.halfLen-0.02;
      zA=U.lerp(zA-0.22, contactA, U.easeInCubic(c)); zB=U.lerp(zB+0.22, contactB, U.easeInCubic(c));
      snap=true;
      A1.leanAll=1; B1.leanAll=1; A1.walk=0.8; B1.walk=-0.8; A1.crouchBias=0.3; B1.crouchBias=0.3;
      A1.shoutAll=1; B1.shoutAll=1;
      if(c>=1 && this.clash && !this.clash.contact){
        this.clash.contact=true; this.clash.contactT=t;
        var cz=mid;
        G.fx.sparks(fxLayer.spark, 0, 0.72, cz, rm?20:50, 1.4);
        if(!rm) G.fx.sparks(fxLayer.spark, 0.4, 1.5, cz, 40, 1.1);
        G.fx.ring(fxLayer.spark, 0.3, 1.2, cz, 0.7, [3.2,2.4,1.2,1], 40);
        G.fx.dust(fxLayer.dust, 0.6, 0, cz, 16, 2.4);
        S.shake(0.9);
        if(!rm){ G.fxState.flash=0.55; G.fxState.impact=1; camState.fov+=6; }
        S.slowmo=0.32;
        A1.jolt+=1.2; B1.jolt+=1.2;
        if(MK.audio.ready()) MK.audio.impact(0, 1);
        S.venue.cheer(0.8);
        this.lockMid=mid; this.curMid=mid;
        if(this.clash.pendLose){ this.clash.pendLose.retreat=this.clash.pendRetreat; this.clash.pendLose=null; }
        /* 判定がもう届いていれば鍔迫り合いを飛ばして押し込みへ（取り残され防止） */
        this.phase=this.clash.resolved?'resolve':'struggle'; this.phaseT=0;
      }
    } else if(ph==='struggle'){
      /* 鍔迫り合い: 判定が届くまで押し合って震える（動きを減らす設定では細かい震えなし） */
      var m=this.lockMid+(rm?0:Math.sin(t*23)*0.015)+Math.sin(pt*2.4)*0.03;
      this.curMid=m;
      zA=m-A1.mk.halfLen+0.02; zB=m+B1.mk.halfLen-0.02; snap=true;
      A1.leanAll=1; B1.leanAll=1; A1.crouchBias=0.3; B1.crouchBias=0.3;
      A1.walk=0.35; B1.walk=-0.35; A1.shoutAll=1; B1.shoutAll=1;
      if(!rm && Math.random()<dt*10) G.fx.sparks(fxLayer.spark, 0, 0.72, m, 3, 0.5);
    } else if(ph==='resolve'){
      /* 判定: 勝った側が判定の差に応じた距離だけ押し込み、そのあと離れる。負けた側はよろけて下がる */
      var cl=this.clash||{ win:'A', strength:0 }, sg=cl.win==='A'?1:-1, wt=sg>0?A1:B1, lt=sg>0?B1:A1;
      var base=this.curMid!==undefined?this.curMid:(this.lockMid!==undefined?this.lockMid:(zA+zB)/2);
      var m2=base+sg*(this.shoveDist||0.5)*U.easeOutCubic(Math.min(1, pt/0.45));
      var k2=U.easeInOutCubic(U.clamp((pt-0.5)/0.9, 0, 1));
      zA=U.lerp(m2-A1.mk.halfLen+0.02, zA, k2); zB=U.lerp(m2+B1.mk.halfLen-0.02, zB, k2);
      snap=pt<0.5;
      wt.leanAll=pt<0.5?1:U.lerp(1,0,U.clamp((pt-0.5)/0.8,0,1));
      lt.leanAll=U.lerp(-0.55,0,U.clamp((pt-0.6)/0.9,0,1));
      wt.walk=pt<0.7?0.9:U.damp(wt.walk,0,3,dt); lt.walk=pt<1.3?0.9:U.damp(lt.walk,0,3,dt);
      wt.cheer=U.damp(wt.cheer, (pt>0.45&&pt<1.7)?1:0, 10, dt); lt.cheer=U.damp(lt.cheer,0,6,dt);
      if(pt>1.8){ this.phase='play'; this.cam='play'; this.curMid=undefined; }
    } else if(ph==='finale'){
      var win=this.youWin?A1:B1, lose=this.youWin?B1:A1;
      var rel=U.clamp((pt-1.6)/0.5, 0, 1);
      win.leanAll=0.9*(1-rel); lose.leanAll=-0.6*(1-rel);
      if(pt<2) lose.stagger=1;
      if(pt>1.6){
        win.walk=U.damp(win.walk,0,3,dt); lose.walk=U.damp(lose.walk,0,3,dt);
        /* 差し上げ: ワッショイの拍で持ち上げる */
        var k=(pt-1.6)/0.62, beatK=k-Math.floor(k);
        win.raise=U.damp(win.raise, 0.55+Math.sin(beatK*Math.PI)*0.45, 8, dt);
        if(Math.floor(k)!==this.lastSashi){ this.lastSashi=Math.floor(k); win.carriers.forEach(function(c){ c.punchT=t; c.tapT=t; });
          if(MK.audio.ready()){ MK.audio.don(0,1); MK.audio.cheer(0,1,0.5); }
          if(this.lastSashi%2===0) G.fx.confetti(fxLayer.confetti, 0, 3.2, win.z, 50, 4);
        }
        lose.sag=U.damp(lose.sag, 1, 2, dt);
        if(win.energy<1) win.energy=U.damp(win.energy,1,2,dt);
        if(Math.random()<dt*3) G.fx.embers(fxLayer.embers, 0, 2.2, win.z, 3, 1.4);
      }
    }
    if(!snap){ A1.z=U.damp(A1.z, zA, 14, dt); B1.z=U.damp(B1.z, zB, 14, dt); }
    else { A1.z=zA; B1.z=zB; }
    /* 担ぎ手のよろめきを戻す */
    [A1,B1].forEach(function(tm){ tm.stagger=Math.max(0, tm.stagger-dt*1.2); });
    A1.update(dt, t, r); B1.update(dt, t, r);
    this.updateCamera(dt, t);
  };
  Arena.prototype.updateCamera=function(dt, t){
    var A1=this.A, B1=this.B, mid=(A1.z+B1.z)/2;
    if(this.cam==='intro'){
      /* 入場: 鳥居の上空から舞い降りて、自分の連の斜め後ろへ */
      var k=U.easeInOutCubic(Math.min(1, this.phaseT/3.4));
      _cp.set(-1.6, 9.5, 13.5).lerp(_cl.set(4.3, 4.8, A1.z-5.0), k); _cp.x+=Math.sin(k*Math.PI)*-2.2;
      S.setCamera(_cp, _cl.set(U.lerp(0,0.1,k), U.lerp(0.4,0.45,k), mid+U.lerp(-1.5,0.35,k)), 52, 6);
      if(this.phaseT>3.4) this.cam='play';
    } else if(this.cam==='play'){
      /* 斜め後ろ上から: 自分の連は右手前、相手の連は左奥。両方の担ぎ手が見える */
      var bob=this.rhythm.active?Math.pow(1-this.rhythm.phase,6)*0.05:0;
      S.setCamera(_cp.set(4.3, 4.8-bob, A1.z-5.0), _cl.set(0.1, 0.45, mid+0.35), 52-bob*16, 3.2);
    } else if(this.cam==='clash'){
      /* 低い位置から、ぶつかる先端をあおる。溜めで寄り、押し込みの間は激突点に留めて動きを見せる */
      var ph=this.phase, cm=(ph==='resolve' && this.phaseT<1.0 && this.lockMid!==undefined)?this.lockMid:mid;
      var fov=(ph==='lean'||ph==='charge')?41:(ph==='windup'?44:46);
      S.setCamera(_cp.set(2.0, 2.9, cm-4.3), _cl.set(-0.3, 0.95, cm+0.5), fov, 4);
    } else if(this.cam==='finale'){
      /* 勝った連を正面（練り場の中央側）から、結界の内側でゆっくり回り込む */
      var win=this.youWin?A1:B1, pt=this.phaseT, k2=U.easeInOutCubic(Math.min(1,pt/3.5));
      S.setCamera(_cp.set(2.2, U.lerp(3.0,1.75,k2), win.z+win.dir*U.lerp(1.4,3.9,k2)), _cl.set(-0.3, 1.0+win.raise*0.5, win.z-win.dir*0.2), 55, 2.2);
    }
  };
  /* 自分の担ぎ手の画面上の位置（「あなた」の目印用） */
  Arena.prototype.selfScreen=function(){
    var c=this.A.selfCarrier; if(!c) return null;
    var p=new T.Vector3(0, 1.0, 0); c.av.root.localToWorld(p);
    p.project(S.camera);
    return { x:(p.x*0.5+0.5)*G.size.w, y:(-p.y*0.5+0.5)*G.size.h, visible:p.z<1 };
  };
  Arena.prototype.dispose=function(){ this.A.removeFrom(S.scene); this.B.removeFrom(S.scene); };

  /* ================= タイトル（担ぎ手が練り歩く神輿） ================= */
  function Title(){
    this.team=new Team({ dir:1, name:'祭', variant:'classic', level:3, members:[] });
    this.team.addTo(S.scene);
    this.team.z=-1;
    this.team.group.position.z=-1;
    this.t0=clock; this.nextBeat=0.4; this.beat=0;
    S.venue.setHype(0.35); S.venue.fireworkRate=0.5;
  }
  Title.prototype.update=function(dt, t){
    var tm=this.team, el=t-this.t0;
    /* 自動の練り: 105BPM で掛け声、たまに揃い・たまにばらける */
    this.nextBeat-=dt;
    if(this.nextBeat<=0){
      this.nextBeat+=0.57; this.beat++;
      var spread=this.beat%8<6?0.03:0.12;
      tm.carriers.forEach(function(c){ var d=Math.max(0,U.randomNormal(0.02,spread)); tm.pending.push({ slot:c.slot, t:performance.now()+d*1000 }); });
      if(this.beat%8===7) G.fx.embers(fxLayer.embers, 0, 1.6, tm.z, 6, 1.2);
    }
    tm.energy=0.5+Math.sin(el*0.8)*0.3;
    var phs=this.nextBeat>0?1-this.nextBeat/0.57:0;
    tm.update(dt, t, { active:true, phase:phs, beatF:this.beat-1+phs });
    /* 楕円で回る: 左右は結界の縄（x=±2.55）の内側に収め、提灯棚や観客に入り込まない */
    var ang=el*0.16+0.6, R=7.4;
    S.setCamera(new T.Vector3(Math.sin(ang)*2.4, 2.3+Math.sin(el*0.3)*0.3, tm.z-Math.cos(ang)*R), new T.Vector3(0, 1.2, tm.z), 50, 2);
  };
  Title.prototype.dispose=function(){ this.team.removeFrom(S.scene); };

  /* ================= 着せ替え（自分のアバターを大きく） ================= */
  function Viewer(o){
    this.o=o;
    this.group=new T.Group(); this.group.position.set(0,0,-8.6);
    S.scene.add(this.group);
    var plat=new T.Mesh(new T.CylinderGeometry(0.62,0.7,0.1,40), G.mat.woodDark()); plat.position.y=0.05; plat.receiveShadow=true;
    this.group.add(plat);
    var ring=new T.Mesh(new T.TorusGeometry(0.66,0.012,6,48), G.mat.goldBright()); ring.rotation.x=Math.PI/2; ring.position.y=0.1; this.group.add(ring);
    this.rebuild(o);
    this.t0=clock;
  }
  Viewer.prototype.rebuild=function(o){
    if(this.av){ this.group.remove(this.av.root); G.disposeTree(this.av.root); }
    this.o=o;
    var outfit=MK.avatar.teamOutfit(o.teamName||'祭', 'classic', false);
    this.av=MK.avatar.build(outfit, o.look||{ skin:1, hair:0, hairStyle:0, face:0 }, { sheetSize:1024 });
    var av=this.av;
    (o.items||[]).forEach(function(it){ MK.avatar.equip(av, it); });
    av.root.position.y=0.1; av.root.scale.multiplyScalar(1.0);
    this.group.add(av.root);
    this.nextPump=1.5;
  };
  Viewer.prototype.update=function(dt, t){
    var el=t-this.t0, av=this.av;
    this.nextPump-=dt;
    var pumpT=this.nextPump<0?Math.min(1,-this.nextPump/0.5):0;
    if(this.nextPump<-0.9){ this.nextPump=2.2+Math.random()*1.5; }
    var punch=pumpT>0?Math.sin(pumpT*Math.PI):0;
    av.pose({ carry:0, side:1, heave:punch*0.6, punch:0, crouch:0.1+Math.sin(el*2.2)*0.05, lean:0, cheer:punch, shout:punch>0.4?1:0,
      face:punch>0.4?'joy':'calm', look:Math.sin(el*0.5)*0.25 });
    av.root.rotation.y=Math.PI+Math.sin(el*0.35)*0.5; /* こちらを向く */
    if(av.rainbowBand) av.tint('band', _col.setHSL((t*0.25)%1,0.85,0.55));
    if(av.aura && Math.random()<dt*14){
      if(av.aura.kind==='sakura') G.fx.petals(fxLayer.petals, 0, 1.2, -8.6, 1, 1.0);
      else G.fx.embers(fxLayer.embers, 0, 0.2, -8.6, 1, 0.7);
    }
    S.setCamera(new T.Vector3(0.35, 0.78, -10.35), new T.Vector3(0, 0.5, -8.6), 42, 3);
  };
  Viewer.prototype.dispose=function(){ S.scene.remove(this.group); G.disposeTree(this.group); };

  /* ================= 場面の切り替え ================= */
  S.showTitle=function(){
    if(!S.ready) return false;
    clearActors();
    S.title=new Title(); S.mode='title';
    var ang=0.6, R=7.4;
    S.setCamera(new T.Vector3(Math.sin(ang)*2.4, 2.3, -1-Math.cos(ang)*R), new T.Vector3(0,1.45,-1), 50, 2, true);
    start(); return true;
  };
  S.showMatch=function(opts){
    if(!S.ready) return null;
    clearActors();
    S.arena=new Arena(opts); S.mode='match';
    S.setCamera(new T.Vector3(-1.6, 9.5, 13.5), new T.Vector3(0,0.4,-1.5), 52, 2, true);
    start(); return S.arena;
  };
  S.showViewer=function(o){
    if(!S.ready) return null;
    if(S.mode==='viewer' && S.viewer){ S.viewer.rebuild(o); return S.viewer; }
    clearActors();
    S.viewer=new Viewer(o); S.mode='viewer';
    S.setCamera(new T.Vector3(0.35, 0.78, -10.35), new T.Vector3(0,0.5,-8.6), 42, 3, true);
    start(); return S.viewer;
  };
  S.clock=function(){ return clock; };
  /* テスト用: WebGLが無くても全様式・アバターの組み立てを実行して破綻を検知する */
  S.selfTest=function(){
    var out=[];
    Object.keys(C.VARIANTS).forEach(function(k){
      for(var lv=0;lv<=4;lv+=4){
        var m=MK.mikoshi.build({ variant:k, teamName:'試験連', level:lv });
        var meshes=0; m.root.traverse(function(o){ if(o.isMesh) meshes++; });
        if(lv===4) out.push(k+':'+meshes);
      }
    });
    var av=MK.avatar.build(MK.avatar.teamOutfit('試験連','classic'), MK.avatar.randomLook(3));
    C.CATALOG.forEach(function(it){ MK.avatar.equip(av, it); });
    av.pose({ carry:1, side:1, heave:0.5, punch:0.5, crouch:0.3, lean:0.4, cheer:0.2, sag:0.1, shout:1 });
    out.push('avatar:'+av.mesh.geometry.attributes.position.count);
    return out;
  };
})();
