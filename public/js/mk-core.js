/* せーの！神輿バトル v2 — 共通部品（定数・採点・音・通信）
 * 定数は server.js の同名定数と必ず一致させること（CLAUDE.md ルール2） */
(function(){
  'use strict';
  var MK = window.MK = window.MK || {};
  /* 端末の「動きを減らす」設定。立っていれば画面の揺れ・閃光・スロー・紙吹雪・振動を抑える */
  try{ MK.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){ MK.reduceMotion=false; }
  /* 端末の設定そのもの（画面の「設定」で手動の ON/OFF を選ぶと MK.reduceMotion だけが上書きされる） */
  MK.deviceReduceMotion = MK.reduceMotion;

  /* ================= 定数 ================= */
  var C = MK.C = {
    ROUNDS: 3,
    SYNC_WINDOW_MS: 100,
    HIT_WINDOW_MS: 250,
    GRADES: [
      { key:'KIWAMI', max:45,  w:1.0,  label:'極', color:'#ffe58a' },
      { key:'YOI',    max:100, w:0.7,  label:'良', color:'#ff9d5c' },
      { key:'KA',     max:170, w:0.4,  label:'可', color:'#9fd7e6' },
      { key:'OSHII',  max:250, w:0.15, label:'惜', color:'#a9a3c9' }
    ],
    JUDGEMENTS: [
      { key:'MIRACLE', min:1.00, label:'MIRACLE!!', sub:'全員一体！',   color:'#ffe58a' },
      { key:'PERFECT', min:0.80, label:'PERFECT!',  sub:'見事な一撃',   color:'#f3c555' },
      { key:'GREAT',   min:0.60, label:'GREAT!',    sub:'力強い突き',   color:'#ff7a4a' },
      { key:'NICE',    min:0.40, label:'NICE',      sub:'まずまず',     color:'#6fd0e0' },
      { key:'MISS',    min:0.00, label:'空振り…',   sub:'揃わなかった', color:'#8e8aa8' }
    ],
    TEMPO_BPM: [96, 108, 120],
    BEATS: 8,
    COUNT_IN: 4,
    BEAT_PTS: 10,
    CLASH_PTS: 30,
    MOMENTUM_SYNC: 0.6,
    MOMENTUM_MAX: 6,
    GACHA_COST: 10,
    MIN_TEAM_FEEL: 8,
    TOUR_LABEL: ['準々決勝', '準決勝', '決勝'],
    ROUND_LABEL: ['一番', '二番', '三番'],
    TEAM_NAME_POOL: ['雷神会','龍虎睦','疾風連','朱雀組','黄金衆','豪傑連','不知火睦','阿吽組','花火連','千年睦'],
    /* 神輿の様式（server.js の VARIANTS と必ず一致させる）
     * 実在の様式を参考: 江戸型(黒漆×金・鳳凰) / 京都祇園の六角 / 築地の八角 /
     * 神明型(白木・千木勝男木) / 大阪・堺の布団太鼓 / 香川のちょうさ / 曳山の山車 */
    VARIANTS: {
      classic:{ label:'黄金',   sides:4, roof:'curved', finial:'phoenix', roofMat:'lacquer', bodyMat:'gold',    accent:0xd8492c, svgRoof:'#1e1838', svgBody:'#dcae48' },
      kuro:   { label:'漆黒',   sides:4, roof:'curved', finial:'phoenix', roofMat:'lacquer', bodyMat:'lacquer', accent:0xe0a33a, svgRoof:'#2a2038', svgBody:'#1c1626' },
      shiro:  { label:'白鳳',   sides:4, roof:'curved', finial:'phoenix', roofMat:'shu',     bodyMat:'ivory',   accent:0xd8492c, svgRoof:'#b03424', svgBody:'#ece2c8' },
      rokkaku:{ label:'六角',   sides:6, roof:'curved', finial:'phoenix', roofMat:'gold',    bodyMat:'gold',    accent:0xd8492c, svgRoof:'#b8912f', svgBody:'#f1cf6b' },
      hakkaku:{ label:'八角',   sides:8, roof:'curved', finial:'phoenix', roofMat:'lacquer', bodyMat:'lacquer', accent:0xe0a33a, svgRoof:'#14101e', svgBody:'#6b5a2a' },
      shinmei:{ label:'白木',   sides:4, roof:'gable',  finial:'chigi',   roofMat:'woodDark',bodyMat:'wood',    accent:0x2e6b4f, svgRoof:'#8a6a3e', svgBody:'#e8d8b0' },
      futon:  { label:'布団',   sides:4, roof:'futon',  finial:'giboshi', roofMat:'shu',     bodyMat:'lacquer', accent:0xd8492c, svgRoof:'#c9321f', svgBody:'#2a2038' },
      chousa: { label:'ちょうさ', sides:4, roof:'chousa', finial:'giboshi', roofMat:'shu',   bodyMat:'lacquer', accent:0xb0202a, svgRoof:'#b0202a', svgBody:'#1c1626' },
      dashi:  { label:'山車',   sides:4, roof:'dashi',  finial:'none',    roofMat:'lacquer', bodyMat:'shu',     accent:0xd8492c, svgRoof:'#1e1838', svgBody:'#8c2f1f' }
    },
    /* 衣装ガチャの景品（server.js の CATALOG と key・レア度を一致させる） */
    CATALOG: [
      { key:'happiAo',       rarity:'N',   name:'藍染め法被',     slot:'happi', color:0x24478f },
      { key:'happiMidori',   rarity:'N',   name:'翠の法被',       slot:'happi', color:0x2d7a52 },
      { key:'happiMurasaki', rarity:'N',   name:'江戸紫の法被',   slot:'happi', color:0x5e3a92 },
      { key:'happiShu',      rarity:'N',   name:'朱色の法被',     slot:'happi', color:0xc1301d },
      { key:'shiroHachimaki',rarity:'N',   name:'白鉢巻',         slot:'band',  color:0xf6f1e4 },
      { key:'festivalFan',   rarity:'N',   name:'祭り扇子',       slot:'hand',  kind:'fan' },
      { key:'goldObi',       rarity:'R',   name:'金襴の帯',       slot:'obi',   color:0xe8c35a },
      { key:'lanternStaff',  rarity:'R',   name:'提灯持ち',       slot:'hand',  kind:'lantern' },
      { key:'sakuraAura',    rarity:'R',   name:'桜吹雪のオーラ', slot:'aura',  color:0xffb7d5, kind:'sakura' },
      { key:'flameHaori',    rarity:'R',   name:'緋色の羽織',     slot:'haori', color:0xa8200e },
      { key:'kitsuneMask',   rarity:'SR',  name:'狐のお面',       slot:'head',  kind:'kitsune' },
      { key:'rainbowHachimaki', rarity:'SR', name:'虹色鉢巻',     slot:'band',  rainbow:true, color:0xff5a8a },
      { key:'ryuHaori',      rarity:'SR',  name:'昇り龍の羽織',   slot:'haori', color:0x1d5e40, dragon:true },
      { key:'shachiHelm',    rarity:'SSR', name:'黄金の鯱兜',     slot:'head',  kind:'shachi' },
      { key:'phoenixAura',   rarity:'SSR', name:'不死鳥のオーラ', slot:'aura',  color:0xffc861, kind:'phoenix' }
    ],
    AD_SPONSORS: [
      { name:'祭りサイダー', tagline:'夏の夜に、しゅわっと一杯', bgTop:'#123a6b', bgBottom:'#0a1a33', vessel:'#bfe6ff' },
      { name:'炎神ビール（ノンアル）', tagline:'祭りの熱さを、キリッと爽快に', bgTop:'#5a1f14', bgBottom:'#1a0a08', vessel:'#ffcf7a' }
    ]
  };
  C.catalogByKey = function(k){
    for(var i=0;i<C.CATALOG.length;i++) if(C.CATALOG[i].key===k) return C.CATALOG[i];
    return null;
  };
  C.judgementByKey = function(k){
    for(var i=0;i<C.JUDGEMENTS.length;i++) if(C.JUDGEMENTS[i].key===k) return C.JUDGEMENTS[i];
    return C.JUDGEMENTS[C.JUDGEMENTS.length-1];
  };
  C.gradeByKey = function(k){
    for(var i=0;i<C.GRADES.length;i++) if(C.GRADES[i].key===k) return C.GRADES[i];
    return null;
  };

  /* ================= 小道具 ================= */
  var U = MK.util = {
    clamp: function(x,a,b){ return x<a?a:(x>b?b:x); },
    clamp01: function(t){ return t<0?0:(t>1?1:t); },
    lerp: function(a,b,t){ return a+(b-a)*t; },
    damp: function(a,b,lambda,dt){ return b+(a-b)*Math.exp(-lambda*dt); },
    easeOutCubic: function(t){ return 1-Math.pow(1-t,3); },
    easeInCubic: function(t){ return t*t*t; },
    easeInOutCubic: function(t){ return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; },
    easeOutBack: function(t){ var c1=1.70158,c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2); },
    randomNormal: function(mean, sd){
      var u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
      return mean+sd*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
    },
    rand: function(a,b){ return a+Math.random()*(b-a); },
    pick: function(arr){ return arr[Math.floor(Math.random()*arr.length)]; },
    hash: function(str){ var h=2166136261; for(var i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); }
      h^=h>>>13; h=Math.imul(h,0x5bd1e995); h^=h>>>15; return h>>>0; },
    /* 決定的な乱数（見た目のばらつきを毎回同じにする） */
    rng: function(seed){ var s=seed>>>0||1; return function(){ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return (s%100000)/100000; }; },
    escapeHtml: function(str){ return String(str).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); },
    wait: function(ms){ return new Promise(function(res){ setTimeout(res, ms); }); },
    hex: function(n){ return '#'+('000000'+(n>>>0).toString(16)).slice(-6); }
  };

  /* ================= 採点（稽古モード用の写し。対戦の点数は server.js が計算する） ================= */
  var S = MK.score = {
    bestWindow: function(events, windowMs){
      if(events.length===0) return { best:0, winners:[] };
      var sorted=events.slice().sort(function(a,b){ return a.time-b.time; });
      var best=0, bestJ=0, bestI=-1, j=0;
      for(var i=0;i<sorted.length;i++){
        while(sorted[i].time-sorted[j].time>windowMs) j++;
        var count=i-j+1;
        if(count>best){ best=count; bestJ=j; bestI=i; }
      }
      return { best:best, winners:sorted.slice(bestJ, bestI+1) };
    },
    gradeOf: function(d){
      var a=Math.abs(d);
      for(var i=0;i<C.GRADES.length;i++) if(a<=C.GRADES[i].max) return C.GRADES[i];
      return null;
    },
    judgementKey: function(pct){
      for(var i=0;i<C.JUDGEMENTS.length;i++) if(pct>=C.JUDGEMENTS[i].min) return C.JUDGEMENTS[i].key;
      return 'MISS';
    },
    momentumMult: function(combo){ return 1+Math.min(combo,C.MOMENTUM_MAX)*0.08; },
    beat: function(taps, teamSize, comboBefore){
      var r=S.bestWindow(taps.map(function(t){ return { id:t.id, time:t.d }; }), C.SYNC_WINDOW_MS);
      var wsum=0; r.winners.forEach(function(w){ var g=S.gradeOf(w.time); if(g) wsum+=g.w; });
      var size=Math.max(1,teamSize), sync=r.winners.length/size;
      var combo=sync>=C.MOMENTUM_SYNC?comboBefore+1:0;
      return { pts:(wsum/size)*C.BEAT_PTS*S.momentumMult(combo), sync:sync, combo:combo,
        synced:r.winners.map(function(w){ return w.id; }) };
    },
    clash: function(taps, teamSize, combo){
      var r=S.bestWindow(taps.map(function(t){ return { id:t.id, time:t.d }; }), C.SYNC_WINDOW_MS);
      var size=Math.max(1,teamSize), pct=r.best/size, wsum=0;
      r.winners.forEach(function(w){ var g=S.gradeOf(w.time); if(g) wsum+=g.w; });
      var acc=r.winners.length?wsum/r.winners.length:0;
      return { pts:pct*acc*C.CLASH_PTS*(1+Math.min(combo,C.MOMENTUM_MAX)*0.05), pct:pct, best:r.best,
        judgement:S.judgementKey(pct), synced:r.winners.map(function(w){ return w.id; }) };
    },
    SKILL: { low:{ sd:88, bias:38, miss:0.12 }, mid:{ sd:56, bias:24, miss:0.05 }, high:{ sd:32, bias:12, miss:0.02 } },
    botMemberPlan: function(skill, beats){
      var s=S.SKILL[skill]||S.SKILL.mid, bias=U.randomNormal(0,s.bias), out=[];
      for(var i=0;i<beats;i++){
        if(Math.random()<s.miss){ out.push(null); continue; }
        var d=Math.round(U.randomNormal(bias,s.sd));
        out.push(Math.abs(d)<=C.HIT_WINDOW_MS?d:null);
      }
      var c=Math.round(U.randomNormal(bias*0.6,s.sd*1.25));
      out.push(Math.random()<s.miss*1.5||Math.abs(c)>C.HIT_WINDOW_MS?null:c);
      return out;
    },
    botTeamPlan: function(n, skill, beats){ var p=[]; for(var i=0;i<n;i++) p.push(S.botMemberPlan(skill,beats)); return p; }
  };

  /* ================= 音（WebAudioで太鼓・笛・歓声を合成） ================= */
  var A = MK.audio = (function(){
    var ctx=null, master=null, comp=null, crowdGain=null, noiseBuf=null, muted=false;
    var bus=null;      /* 太鼓・拍子木・声・笛・歓声の出口。予約済みの音をまとめて止めるときは付け替える（cancelScheduled） */
    var volume=1;      /* 音量 0〜1（設定画面） */
    var offsetMs=0;    /* 音のタイミング調整（ms）。＋で音を早く鳴らす。タップの判定・送信時刻には使わない */
    function init(){
      if(ctx) { if(ctx.state==='suspended') try{ ctx.resume(); }catch(e){} return true; }
      var AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return false;
      try{
        ctx=new AC({ latencyHint:'interactive' });
        comp=ctx.createDynamicsCompressor();
        comp.threshold.value=-14; comp.knee.value=12; comp.ratio.value=4; comp.attack.value=0.003; comp.release.value=0.2;
        master=ctx.createGain(); master.gain.value=0.9*volume;
        master.connect(comp); comp.connect(ctx.destination);
        bus=ctx.createGain(); bus.connect(master);
        var len=ctx.sampleRate*2; noiseBuf=ctx.createBuffer(1,len,ctx.sampleRate);
        var d=noiseBuf.getChannelData(0); for(var i=0;i<len;i++) d[i]=Math.random()*2-1;
        startCrowd();
        return true;
      }catch(e){ ctx=null; return false; }
    }
    function ok(){ return !!ctx && !muted; }
    function now(){ return ctx?ctx.currentTime:0; }
    /* 出力の遅れ（Bluetooth等）。スケジュールをこの分だけ早めて、耳に届く時刻を拍に合わせる */
    function latency(){
      if(!ctx) return 0;
      var l=(ctx.outputLatency||0)+(ctx.baseLatency||0);
      return Math.max(0, Math.min(0.25, l));
    }
    function noise(){ var s=ctx.createBufferSource(); s.buffer=noiseBuf; s.loop=true; return s; }
    function env(g, t, a, peak, decay){
      g.gain.setValueAtTime(0.0001,t);
      g.gain.exponentialRampToValueAtTime(peak,t+a);
      g.gain.exponentialRampToValueAtTime(0.0001,t+a+decay);
    }
    /* 大太鼓「ドン」 */
    function don(t, vel){
      if(!ok()) return; t=t||ctx.currentTime; vel=vel||1;
      var o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.setValueAtTime(118,t); o.frequency.exponentialRampToValueAtTime(52,t+0.22);
      env(g,t,0.004,0.95*vel,0.55); o.connect(g); g.connect(bus); o.start(t); o.stop(t+0.7);
      var o2=ctx.createOscillator(), g2=ctx.createGain();
      o2.type='triangle'; o2.frequency.setValueAtTime(220,t); o2.frequency.exponentialRampToValueAtTime(96,t+0.08);
      env(g2,t,0.002,0.35*vel,0.12); o2.connect(g2); g2.connect(bus); o2.start(t); o2.stop(t+0.2);
      var n=noise(), f=ctx.createBiquadFilter(), g3=ctx.createGain();
      f.type='lowpass'; f.frequency.value=900; env(g3,t,0.001,0.5*vel,0.07);
      n.connect(f); f.connect(g3); g3.connect(bus); n.start(t, Math.random()); n.stop(t+0.12);
    }
    /* 締太鼓・縁打ち「カッ」 */
    function ka(t, vel){
      if(!ok()) return; t=t||ctx.currentTime; vel=vel||1;
      var n=noise(), f=ctx.createBiquadFilter(), g=ctx.createGain();
      f.type='bandpass'; f.frequency.value=2600; f.Q.value=3.5;
      env(g,t,0.001,0.6*vel,0.045); n.connect(f); f.connect(g); g.connect(bus); n.start(t, Math.random()); n.stop(t+0.08);
      var o=ctx.createOscillator(), g2=ctx.createGain();
      o.type='square'; o.frequency.value=1250; env(g2,t,0.001,0.12*vel,0.03);
      o.connect(g2); g2.connect(bus); o.start(t); o.stop(t+0.05);
    }
    /* 拍子木「チョン」（前打ち） */
    function hyoshigi(t){
      if(!ok()) return; t=t||ctx.currentTime;
      [0,0.018].forEach(function(dt,k){
        var o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
        o.type='square'; o.frequency.value=k?2150:1780; f.type='highpass'; f.frequency.value=900;
        env(g,t+dt,0.001,0.32,0.06); o.connect(f); f.connect(g); g.connect(bus); o.start(t+dt); o.stop(t+dt+0.09);
      });
    }
    /* 祭り笛・ホイッスル「ピッ」 */
    function whistle(t, dur, pitch, vol){
      if(!ok()) return; t=t||ctx.currentTime; dur=dur||0.16; pitch=pitch||2900;
      var o=ctx.createOscillator(), g=ctx.createGain(), lfo=ctx.createOscillator(), lg=ctx.createGain();
      o.type='sine'; o.frequency.setValueAtTime(pitch*0.93,t); o.frequency.linearRampToValueAtTime(pitch,t+0.03);
      lfo.frequency.value=38; lg.gain.value=pitch*0.018; lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol||0.2,t+0.012);
      g.gain.setValueAtTime(vol||0.2,t+dur-0.03); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
      o.connect(g); g.connect(bus); o.start(t); lfo.start(t); o.stop(t+dur+0.02); lfo.stop(t+dur+0.02);
      var n=noise(), f=ctx.createBiquadFilter(), g2=ctx.createGain();
      f.type='bandpass'; f.frequency.value=pitch; f.Q.value=8; env(g2,t,0.005,0.05,dur);
      n.connect(f); f.connect(g2); g2.connect(bus); n.start(t, Math.random()); n.stop(t+dur+0.05);
    }
    /* 掛け声っぽい声（「せー」「の」）: 声帯音＋フォルマント */
    function voice(t, vowel, dur, pitch){
      if(!ok()) return; t=t||ctx.currentTime; dur=dur||0.3; pitch=pitch||150;
      var F={ e:[530,1850,2500], o:[500,850,2600], a:[750,1250,2600] }[vowel]||[600,1400,2500];
      var src=ctx.createOscillator(); src.type='sawtooth';
      src.frequency.setValueAtTime(pitch*1.08,t); src.frequency.linearRampToValueAtTime(pitch,t+dur);
      var out=ctx.createGain(); env(out,t,0.02,0.55,dur);
      F.forEach(function(fr,i){
        var bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=fr; bp.Q.value=9-i*2;
        var gg=ctx.createGain(); gg.gain.value=[1,0.55,0.3][i];
        src.connect(bp); bp.connect(gg); gg.connect(out);
      });
      if(vowel==='e'){ /* 「せ」の摩擦音 */
        var n=noise(), hp=ctx.createBiquadFilter(), ng=ctx.createGain();
        hp.type='highpass'; hp.frequency.value=4200; ng.gain.setValueAtTime(0.0001,t-0.07);
        ng.gain.exponentialRampToValueAtTime(0.25,t-0.03); ng.gain.exponentialRampToValueAtTime(0.0001,t+0.02);
        n.connect(hp); hp.connect(ng); ng.connect(bus); n.start(Math.max(ctx.currentTime,t-0.08)); n.stop(t+0.05);
      }
      out.connect(bus); src.start(t); src.stop(t+dur+0.05);
    }
    /* 激突「ドドーン＋金属音」 */
    function impact(t, power){
      if(!ok()) return; t=t||ctx.currentTime; power=power||1;
      don(t,1.2*power); don(t+0.06,0.9*power);
      var n=noise(), f=ctx.createBiquadFilter(), g=ctx.createGain();
      f.type='lowpass'; f.frequency.setValueAtTime(5000,t); f.frequency.exponentialRampToValueAtTime(300,t+0.6);
      env(g,t,0.002,0.7*power,0.7); n.connect(f); f.connect(g); g.connect(bus); n.start(t, Math.random()); n.stop(t+0.9);
      var sub=ctx.createOscillator(), sg=ctx.createGain();
      sub.type='sine'; sub.frequency.setValueAtTime(70,t); sub.frequency.exponentialRampToValueAtTime(32,t+0.6);
      env(sg,t,0.003,0.9*power,0.8); sub.connect(sg); sg.connect(bus); sub.start(t); sub.stop(t+1);
      [523,789,1187,1644].forEach(function(fr,i){
        var o=ctx.createOscillator(), og=ctx.createGain();
        o.type='sine'; o.frequency.value=fr*(1+Math.random()*0.02);
        env(og,t+0.01,0.002,0.09*power/(i+1),1.2-i*0.2); o.connect(og); og.connect(bus); o.start(t); o.stop(t+1.4);
      });
    }
    /* 歓声 */
    function cheer(t, dur, level){
      if(!ok()) return; t=t||ctx.currentTime; dur=dur||1.6; level=level||0.5;
      [[700,1.2],[1300,1.6],[2400,2.2]].forEach(function(b){
        var n=noise(), f=ctx.createBiquadFilter(), g=ctx.createGain();
        f.type='bandpass'; f.frequency.value=b[0]; f.Q.value=b[1];
        g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(level*0.4,t+0.18);
        g.gain.setValueAtTime(level*0.4,t+dur*0.5); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
        n.connect(f); f.connect(g); g.connect(bus); n.start(t, Math.random()); n.stop(t+dur+0.05);
      });
    }
    /* 観客のざわめき（常時） */
    function startCrowd(){
      var n=noise(), f=ctx.createBiquadFilter(), f2=ctx.createBiquadFilter();
      f.type='bandpass'; f.frequency.value=650; f.Q.value=0.8; f2.type='lowpass'; f2.frequency.value=2200;
      crowdGain=ctx.createGain(); crowdGain.gain.value=0.0001;
      var lfo=ctx.createOscillator(), lg=ctx.createGain(); lfo.frequency.value=0.23; lg.gain.value=0.012;
      lfo.connect(lg); lg.connect(crowdGain.gain);
      n.connect(f); f.connect(f2); f2.connect(crowdGain); crowdGain.connect(master); n.start(); lfo.start();
    }
    function setCrowd(level){
      if(!ctx||!crowdGain) return;
      var v=Math.max(0.0001, (muted?0:level)*0.06);
      crowdGain.gain.cancelScheduledValues(ctx.currentTime);
      crowdGain.gain.setTargetAtTime(v, ctx.currentTime, 0.4);
    }
    /* 三味線風のはじき（勝利・UI用） */
    function pluck(t, freq, vol){
      if(!ok()) return; t=t||ctx.currentTime;
      var o=ctx.createOscillator(), f=ctx.createBiquadFilter(), g=ctx.createGain();
      o.type='sawtooth'; o.frequency.value=freq; f.type='lowpass';
      f.frequency.setValueAtTime(freq*8,t); f.frequency.exponentialRampToValueAtTime(freq*1.5,t+0.25);
      env(g,t,0.002,vol||0.22,0.5); o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t+0.6);
    }
    function fanfare(win){
      if(!ok()) return; var t=ctx.currentTime+0.05;
      var notes=win?[392,440,523,587,659,784]:[440,392,349,330];
      notes.forEach(function(f,i){ pluck(t+i*0.11, f, 0.2); });
      if(win){ don(t+0.7,1); don(t+0.95,1.1); cheer(t+0.6,2.6,0.9); }
    }
    function tick(){ if(ok()) pluck(ctx.currentTime, 880, 0.08); }
    function select(){ if(ok()){ pluck(ctx.currentTime, 659, 0.12); pluck(ctx.currentTime+0.06, 988, 0.1); } }
    function sparkle(){ if(!ok()) return; var t=ctx.currentTime; [1568,2093,2637,3136].forEach(function(f,i){ pluck(t+i*0.07,f,0.07); }); }
    return {
      init:init, now:now, latency:latency, don:don, ka:ka, hyoshigi:hyoshigi, whistle:whistle, voice:voice,
      impact:impact, cheer:cheer, setCrowd:setCrowd, pluck:pluck, fanfare:fanfare, tick:tick, select:select, sparkle:sparkle,
      ready:function(){ return !!ctx; },
      /* 予約済みの太鼓・拍子木・声・笛・歓声をまとめて止める（稽古を途中でやめたとき）。
       * 予約した音は1つずつ取り消せないので、出口ごと外して新しい出口に付け替える。操作音（pluck）とざわめきは止めない */
      cancelScheduled:function(){
        if(!ctx || !bus) return;
        try{ bus.disconnect(); }catch(e){}
        bus=ctx.createGain(); bus.connect(master);
      },
      setMuted:function(m){ muted=!!m; setCrowd(0); },
      isMuted:function(){ return muted; },
      setVolume:function(v){
        volume=Math.max(0, Math.min(1, +v||0));
        if(ctx && master){ try{ master.gain.setTargetAtTime(0.9*volume, ctx.currentTime, 0.03); }catch(e){ master.gain.value=0.9*volume; } }
      },
      getVolume:function(){ return volume; },
      /* 音のタイミング調整（-150〜+150ms・10ms刻み）。拍に合わせて鳴らす音（太鼓・拍子木・声）だけをずらす */
      setOffset:function(ms){ ms=Math.round((+ms||0)/10)*10; offsetMs=Math.max(-150, Math.min(150, ms)); },
      offset:function(){ return offsetMs; },
      /* サーバー時刻(ms) → 音の時刻(s)。出力遅延と調整値のぶん早めに鳴らす */
      timeFor:function(serverMs){
        if(!ctx) return 0;
        return ctx.currentTime + (serverMs - MK.net.serverNow() - offsetMs)/1000 - latency();
      }
    };
  })();

  /* ================= 通信（WebSocket・時計合わせ） ================= */
  MK.net = (function(){
    var ws=null, handlers={}, samples=[], offset=0, pingTimer=null, queue=[], onOpenCbs=[];
    function serverNow(){ return Date.now()+offset; }
    function send(obj){
      if(ws && ws.readyState===1){ try{ ws.send(JSON.stringify(obj)); }catch(e){} }
    }
    function on(t, fn){ handlers[t]=fn; }
    function setPill(txt, good){
      var p=document.getElementById('connPill'); if(!p) return;
      p.textContent=txt; p.className='conn-pill'+(good?' ok':'');
    }
    /* 往復時間が最も短かった計測を信じる（NTP方式） */
    function onPong(msg){
      var now=Date.now(), rtt=now-msg.c;
      if(rtt<0||rtt>5000) return;
      samples.push({ rtt:rtt, off:msg.s+rtt/2-now });
      if(samples.length>16) samples.shift();
      var best=samples[0];
      for(var i=1;i<samples.length;i++) if(samples[i].rtt<best.rtt) best=samples[i];
      offset=best.off;
    }
    function burst(n){
      for(var i=0;i<n;i++) (function(k){ setTimeout(function(){ send({ t:'ping', c:Date.now() }); }, k*120); })(i);
    }
    function connect(onOpen){
      if(onOpen) onOpenCbs.push(onOpen);
      if(ws && (ws.readyState===0 || ws.readyState===1)){
        if(ws.readyState===1){ var cbs=onOpenCbs; onOpenCbs=[]; cbs.forEach(function(f){ f(); }); }
        return;
      }
      var proto=location.protocol==='https:'?'wss:':'ws:';
      try{ ws=new WebSocket(proto+'//'+location.host+'/ws'); }catch(e){ setPill('オフライン', false); return; }
      setPill('接続中…', false);
      ws.onopen=function(){
        setPill('オンライン', true);
        burst(6);
        clearInterval(pingTimer);
        pingTimer=setInterval(function(){ burst(2); }, 8000);
        var cbs=onOpenCbs; onOpenCbs=[]; cbs.forEach(function(f){ f(); });
        if(handlers.__open) handlers.__open();
      };
      ws.onmessage=function(ev){
        var msg; try{ msg=JSON.parse(ev.data); }catch(e){ return; }
        if(msg.t==='pong'){ onPong(msg); return; }
        if(msg.t==='sping'){ send({ t:'spong', s:msg.s }); return; } /* サーバーが往復時間を測る */
        var h=handlers[msg.t];
        if(h){ try{ h(msg); }catch(e){ if(window.console) console.error('handler', msg.t, e); } }
      };
      ws.onclose=function(){
        setPill('再接続中…', false);
        clearInterval(pingTimer);
        setTimeout(function(){ connect(); }, 1500);
        if(handlers.__close) handlers.__close();
      };
      ws.onerror=function(){};
    }
    return {
      connect:connect, send:send, on:on, serverNow:serverNow,
      isConnected:function(){ return !!ws && ws.readyState===1; },
      offset:function(){ return offset; }
    };
  })();
})();
