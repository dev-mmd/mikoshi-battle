/* せーの！神輿バトル v2 — 画面の流れと操作
 * 点数・勝敗・コインはサーバー(server.js)が決める。ここは「見せ方」と「タップの送信」だけ。
 * 例外は稽古モード（コインが出ない練習）で、このファイルの中の小さな採点係が代わりを務める。 */
(function(){
  'use strict';
  var MK=window.MK, C=MK.C, U=MK.util, A=MK.audio, NET=MK.net, STAGE=MK.stage, SC=MK.score;
  function $(id){ return document.getElementById(id); }

  /* ================= 状態 ================= */
  var state={
    pid:null, token:null, name:'', coins:0, wins:0, owned:[], equipped:{},
    roomId:null, teamName:'', variant:'classic', level:0, members:[], botFill:0, streak:0,
    teamList:[], selectedTeamId:null, selectedCreate:true, customTeamName:'', customVariant:'classic',
    needAd:true, awaitingWelcome:false, gachaBusy:false, practice:false, inviteTeamId:null,
    match:null
  };

  /* ================= 画面切り替え（幕が閉じて開く） ================= */
  var wipeEl=$('wipe'), wipeBusy=false, pendingScreen=null;
  /* 幕が閉じている途中は、行き先の画面を「今の画面」として扱う（返事が先に届いても取りこぼさない） */
  function activeScreen(){ if(pendingScreen) return pendingScreen; var a=document.querySelector('.screen.active'); return a?a.id:null; }
  function rawShow(id){
    pendingScreen=null;
    var cur=document.querySelector('.screen.active'); if(cur) cur.classList.remove('active');
    var el=$(id); if(el) el.classList.add('active');
    document.body.classList.toggle('in-match', id==='screen-match');
    if(document.scrollingElement) document.scrollingElement.scrollTop=0;
    /* 読み上げ・キーボード操作のため、新しい画面の見出しへフォーカスを移す */
    var h=el && el.querySelector('h1,h2');
    if(h && id!=='screen-match'){ h.setAttribute('tabindex','-1'); try{ h.focus({ preventScroll:true }); }catch(e){} }
    if(id==='screen-teamselect') buildTeamSelect();
  }
  function showScreen(id, instant){
    if(activeScreen()===id) return;
    if(instant || wipeBusy || !wipeEl){ rawShow(id); return; }
    wipeBusy=true; pendingScreen=id;
    wipeEl.className='closing';
    setTimeout(function(){
      rawShow(id);
      wipeEl.className='hold';
      setTimeout(function(){ wipeEl.className='opening'; setTimeout(function(){ wipeEl.className=''; wipeBusy=false; }, 520); }, 90);
    }, 400);
  }
  var toastEl=$('toast'), toastTimer=null;
  function toast(text){
    toastEl.textContent=text; toastEl.classList.remove('hidden'); void toastEl.offsetWidth; toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){ toastEl.classList.remove('show'); setTimeout(function(){ toastEl.classList.add('hidden'); }, 250); }, 1600);
  }
  function tick(){ A.tick(); }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

  /* ================= 通信の窓口（オンライン or 稽古） ================= */
  var H={};           /* メッセージ種別 → 処理 */
  var TX=NET;          /* send / serverNow を持つもの */
  var PRACTICE_ID='practice-me';
  var CONTINUE_MS=20000; /* 勝利後「次の対戦へ」の受付時間（server.js の CONTINUE_WAIT_MAX と同じ既定値） */
  var lastAudioKey=null; /* 太鼓の音を予約済みの番（"番:開始時刻"）。再接続で同じ番が送り直されても音を二重に予約しない */
  function myId(){ return state.practice?PRACTICE_ID:state.pid; }
  function perfOf(serverMs){ return performance.now()+(serverMs-TX.serverNow()); }
  /* 画面の時刻 → 音の時刻。出力遅延と「音のタイミング調整」のぶん早めに鳴らす（タップの判定には使わない） */
  function acAt(perfT){ return A.now()+(perfT-A.offset()-performance.now())/1000-A.latency(); }

  /* ================= 小窓（設定・遊び方）の開け閉め ================= */
  var modalReturn=null;
  function openModal(id, focusId){
    modalReturn=document.activeElement;
    $(id).classList.remove('hidden');
    var el=$(focusId);
    if(el){ if(!/^(BUTTON|INPUT)$/.test(el.tagName)) el.setAttribute('tabindex','-1'); try{ el.focus({ preventScroll:true }); }catch(e){} }
  }
  function closeModal(id){
    $(id).classList.add('hidden');
    var r=modalReturn; modalReturn=null;
    if(r && r.focus && document.body.contains(r)) try{ r.focus({ preventScroll:true }); }catch(e){}
  }
  function modalOpen(){ return !$('settingsModal').classList.contains('hidden') || !$('howtoModal').classList.contains('hidden'); }
  /* Tab で小窓の外へ出ないようにする */
  function trapFocus(e){
    if(e.key!=='Tab') return;
    var box=e.currentTarget, list=Array.prototype.filter.call(box.querySelectorAll('button,input'), function(x){ return !x.disabled && x.offsetParent!==null; });
    if(!list.length) return;
    var first=list[0], last=list[list.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  }

  /* ================= 設定（音・音量・音のタイミング・動きを減らす） ================= */
  var SETTINGS_KEY='mikoshiSettings';
  var settings={ volume:1, offset:0, motion:'auto' }; /* motion: auto=端末に合わせる / on / off */
  (function loadSettings(){
    try{
      var s=JSON.parse(lsGet(SETTINGS_KEY)||'null');
      if(s && typeof s==='object'){
        if(isFinite(s.volume)) settings.volume=U.clamp(+s.volume,0,1);
        if(isFinite(s.offset)) settings.offset=U.clamp(Math.round(+s.offset/10)*10,-150,150);
        if(s.motion==='on' || s.motion==='off') settings.motion=s.motion;
      }
    }catch(e){}
  })();
  function saveSettings(){ lsSet(SETTINGS_KEY, JSON.stringify(settings)); }
  function applySettings(){
    A.setVolume(settings.volume); A.setOffset(settings.offset);
    MK.reduceMotion = settings.motion==='auto' ? !!MK.deviceReduceMotion : settings.motion==='on';
    document.body.classList.toggle('reduce-motion', settings.motion==='on');
  }
  applySettings();
  function fmtOffset(ms){ return ms===0?'±0ms':(ms>0?('+'+ms+'ms 早め'):(ms+'ms 遅め')); }
  var muteBtn=$('muteBtn');
  var ICON_SOUND='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.6 6a8.6 8.6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var ICON_MUTE='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function syncMute(m){
    muteBtn.innerHTML=m?ICON_MUTE:ICON_SOUND;
    muteBtn.setAttribute('aria-label','消音'); muteBtn.setAttribute('aria-pressed', m?'true':'false');
    var sb=$('setSoundBtn'); sb.setAttribute('aria-checked', m?'false':'true'); sb.textContent=m?'オフ':'オン';
  }
  function setMuted(m){
    A.init(); A.setMuted(m); syncMute(m);
    lsSet('mikoshiMuted', m?'1':'0');
    if(!m){ A.setCrowd(activeScreen()==='screen-match'?0.8:0.4); A.select(); }
  }
  if(lsGet('mikoshiMuted')==='1') A.setMuted(true);
  syncMute(A.isMuted());
  muteBtn.addEventListener('click', function(){ setMuted(!A.isMuted()); });

  function renderSettings(){
    syncMute(A.isMuted());
    var v=Math.round(settings.volume*100); $('setVolume').value=v; $('setVolumeVal').textContent=v;
    $('setOffset').value=settings.offset; $('setOffsetVal').textContent=fmtOffset(settings.offset);
    var rm=!!MK.reduceMotion, mb=$('setMotionBtn');
    mb.setAttribute('aria-checked', rm?'true':'false'); mb.textContent=rm?'オン':'オフ';
    $('setMotionNote').textContent=(settings.motion==='auto'?'いまは端末の設定に合わせています。':'')+'オンにすると画面の揺れ・閃光・スロー・振動を抑えます。';
    $('setMotionAutoBtn').classList.toggle('hidden', settings.motion==='auto');
  }
  function openSettings(){
    A.init(); renderSettings();
    $('settingsMain').classList.remove('hidden'); $('calibPanel').classList.add('hidden');
    openModal('settingsModal', 'settingsTitle');
  }
  function closeSettings(){ stopCalib(); closeModal('settingsModal'); }
  function setOffset(ms){
    settings.offset=U.clamp(Math.round(ms/10)*10,-150,150); A.setOffset(settings.offset); saveSettings();
    $('setOffset').value=settings.offset; $('setOffsetVal').textContent=fmtOffset(settings.offset);
  }
  $('setSoundBtn').addEventListener('click', function(){ setMuted(!A.isMuted()); });
  $('setVolume').addEventListener('input', function(){
    settings.volume=U.clamp((+this.value||0)/100,0,1); A.setVolume(settings.volume);
    $('setVolumeVal').textContent=Math.round(settings.volume*100); saveSettings();
  });
  $('setVolume').addEventListener('change', function(){ A.init(); A.select(); });
  $('setOffset').addEventListener('input', function(){ setOffset(+this.value||0); });
  $('setOffsetMinus').addEventListener('click', function(){ tick(); setOffset(settings.offset-10); });
  $('setOffsetPlus').addEventListener('click', function(){ tick(); setOffset(settings.offset+10); });
  $('setMotionBtn').addEventListener('click', function(){ tick(); settings.motion=MK.reduceMotion?'off':'on'; applySettings(); saveSettings(); renderSettings(); });
  $('setMotionAutoBtn').addEventListener('click', function(){ tick(); settings.motion='auto'; applySettings(); saveSettings(); renderSettings(); try{ $('setMotionBtn').focus(); }catch(e){} });
  $('settingsCloseBtn').addEventListener('click', function(){ tick(); closeSettings(); });
  $('settingsHowtoBtn').addEventListener('click', function(){ tick(); closeSettings(); showHowto(null); });
  $('settingsModal').addEventListener('keydown', function(e){ if(e.key==='Escape') closeSettings(); else trapFocus(e); });
  $('titleSettingsBtn').addEventListener('click', function(){ tick(); openSettings(); });
  $('mypageSettingsBtn').addEventListener('click', function(){ tick(); openSettings(); });

  /* ---- 音のタイミングを測る: 一定のテンポの太鼓に合わせて叩き、ズレの中央値から調整値を出す ---- */
  var calib=null, CALIB_TAPS=8;
  function stopCalib(){ if(calib){ calib.timers.forEach(clearTimeout); calib=null; } }
  function startCalib(){
    stopCalib(); A.init();
    $('calibResult').classList.add('hidden'); $('calibApplyBtn').classList.add('hidden'); $('calibRetryBtn').classList.add('hidden');
    if(A.isMuted() || !A.ready()){
      $('calibStatus').textContent='音がオフです。「音を出す」をオンにしてから測ってください';
      $('calibRetryBtn').classList.remove('hidden'); return;
    }
    var beatMs=600, total=16, t0=performance.now()+900;
    calib={ t0:t0, beatMs:beatMs, total:total, ds:[], used:{}, timers:[], rec:null };
    /* 測るときは調整値を使わず、そのまま鳴らす */
    for(var k=0;k<total;k++){
      var t=A.now()+(t0+k*beatMs-performance.now())/1000-A.latency();
      if(k<2) A.hyoshigi(t); else A.don(t, k%2?0.85:1);
    }
    $('calibStatus').textContent='拍子木が2回鳴ったあと、太鼓に合わせて叩いてください';
    calib.timers.push(setTimeout(finishCalib, 900+total*beatMs+300));
  }
  function calibTap(){
    var c=calib; if(!c || c.rec!==null) return;
    var now=performance.now(), k=Math.round((now-c.t0)/c.beatMs), d=now-(c.t0+k*c.beatMs);
    if(k<2 || k>=c.total || c.used[k] || Math.abs(d)>c.beatMs*0.45) return;
    c.used[k]=true; c.ds.push(d);
    var left=CALIB_TAPS-c.ds.length;
    $('calibStatus').textContent=left>0?('あと'+left+'回'):'測り終えました';
    if(left<=0) finishCalib();
  }
  function finishCalib(){
    var c=calib; if(!c || c.rec!==null) return;
    c.timers.forEach(clearTimeout); c.timers=[];
    $('calibRetryBtn').classList.remove('hidden');
    if(c.ds.length<5){ $('calibStatus').textContent='うまく測れませんでした。もう一度試してください'; calib=null; return; }
    var s=c.ds.slice().sort(function(a,b){ return a-b; }), med=s[Math.floor(s.length/2)];
    c.rec=U.clamp(Math.round(med/10)*10,-150,150);
    $('calibStatus').textContent=Math.abs(med)<15?'ほぼぴったりです':(med>0?('平均 '+Math.round(med)+'ms 遅れて叩いています'):('平均 '+Math.round(-med)+'ms 早く叩いています'));
    var r=$('calibResult'); r.textContent='おすすめ '+fmtOffset(c.rec); r.classList.remove('hidden');
    $('calibApplyBtn').classList.remove('hidden');
  }
  $('calibOpenBtn').addEventListener('click', function(){
    tick(); $('settingsMain').classList.add('hidden'); $('calibPanel').classList.remove('hidden');
    $('calibStatus').textContent='準備中…';
    var h=$('calibTitle'); h.setAttribute('tabindex','-1'); try{ h.focus({ preventScroll:true }); }catch(e){}
    startCalib();
  });
  $('calibPad').addEventListener('pointerdown', function(e){ if(e.cancelable) e.preventDefault(); calibTap(); });
  $('calibPad').addEventListener('keydown', function(e){ if((e.key===' '||e.key==='Enter') && !e.repeat){ e.preventDefault(); calibTap(); } });
  $('calibRetryBtn').addEventListener('click', function(){ tick(); startCalib(); });
  $('calibApplyBtn').addEventListener('click', function(){
    if(!calib || calib.rec===null) return;
    A.select(); setOffset(calib.rec); stopCalib();
    $('calibPanel').classList.add('hidden'); $('settingsMain').classList.remove('hidden');
    try{ $('setOffset').focus(); }catch(e){}
    toast('音のタイミングを '+fmtOffset(settings.offset)+' にしました');
  });
  $('calibBackBtn').addEventListener('click', function(){
    tick(); stopCalib(); $('calibPanel').classList.add('hidden'); $('settingsMain').classList.remove('hidden');
    try{ $('calibOpenBtn').focus(); }catch(e){}
  });

  /* ================= 初めての人への「遊び方」 ================= */
  var HOWTO_KEY='mikoshiHowtoSeen', howtoNext=null;
  function showHowto(next){
    howtoNext=next||null;
    $('howtoStartBtn').textContent=next?'稽古をはじめる':'閉じる';
    openModal('howtoModal', 'howtoTitle');
  }
  $('howtoStartBtn').addEventListener('click', function(){
    A.init(); A.select(); lsSet(HOWTO_KEY, '1');
    closeModal('howtoModal');
    var f=howtoNext; howtoNext=null; if(f) f();
  });
  $('howtoModal').addEventListener('keydown', function(e){ if(e.key==='Escape'){ howtoNext=null; closeModal('howtoModal'); } else trapFocus(e); });

  /* ================= タイトル ================= */
  function enterTitle(){
    rawShow('screen-title');
    if(STAGE.ready || STAGE.init($('threeCanvas'))) STAGE.showTitle();
    A.setCrowd(0.4);
  }
  $('titleStartBtn').addEventListener('click', function(){
    A.init(); A.select();
    state.practice=false; TX=NET;
    if(state.pid){
      NET.send({ t:'listTeams' });
      showScreen('screen-teamselect');
      if(state.inviteTeamId){ var tid=state.inviteTeamId; state.inviteTeamId=null; NET.send({ t:'joinTeam', id:tid }); }
    } else showScreen('screen-login');
  });
  $('titlePracticeBtn').addEventListener('click', function(){
    A.init(); A.select();
    /* 初めての人には、稽古の前に1枚だけ遊び方を見せる */
    if(lsGet(HOWTO_KEY)!=='1') showHowto(startPractice); else startPractice();
  });
  $('loginBackBtn').addEventListener('click', function(){ tick(); showScreen('screen-title'); });

  /* ================= ログイン ================= */
  var joinBtn=$('joinBtn'), nickInput=$('nickInput');
  joinBtn.addEventListener('click', function(){
    var name=(nickInput.value||'').trim();
    if(!name && !state.token){ toast('ニックネームを入力してください'); nickInput.focus(); return; }
    joinBtn.disabled=true; joinBtn.textContent='接続中…';
    state.awaitingWelcome=true;
    var doReg=function(){ NET.send({ t:'register', token:state.token, name:name }); };
    if(NET.isConnected()) doReg(); else NET.connect(doReg);
    setTimeout(function(){
      if(state.awaitingWelcome){ state.awaitingWelcome=false; joinBtn.disabled=false; joinBtn.textContent='オンラインで参加'; toast('サーバーに接続できません…'); }
    }, 8000);
  });
  nickInput.addEventListener('keydown', function(e){ if(e.key==='Enter') joinBtn.click(); });
  function initGoogleLogin(){
    if(typeof fetch!=='function') return;
    fetch('/auth-config').then(function(r){ return r.json(); }).then(function(cfg){
      if(!cfg || !cfg.googleClientId) return;
      var s=document.createElement('script');
      s.src='https://accounts.google.com/gsi/client'; s.async=true; s.defer=true;
      s.onload=function(){
        try{
          window.google.accounts.id.initialize({
            client_id:cfg.googleClientId,
            callback:function(resp){
              if(!resp || !resp.credential) return;
              state.awaitingWelcome=true;
              var doReg=function(){ NET.send({ t:'register', gtoken:resp.credential, token:state.token, name:(nickInput.value||'').trim() }); };
              if(NET.isConnected()) doReg(); else NET.connect(doReg);
            }
          });
          window.google.accounts.id.renderButton($('gsiButtonHost'), { theme:'filled_blue', size:'large', shape:'pill', text:'signin_with', locale:'ja' });
          $('googleLoginWrap').classList.remove('hidden');
        }catch(e){}
      };
      document.head.appendChild(s);
    }).catch(function(){});
  }

  /* ================= 店舗QR ================= */
  function renderQrCells(container, text){
    container.innerHTML='';
    try{
      if(typeof qrcode!=='undefined'){
        var qr=qrcode(0,'M'); qr.addData(text); qr.make();
        var n=qr.getModuleCount();
        container.style.gridTemplateColumns='repeat('+n+',1fr)'; container.style.gridTemplateRows='repeat('+n+',1fr)';
        for(var r=0;r<n;r++) for(var c=0;c<n;c++){ var cell=document.createElement('div'); cell.className='qr-cell'+(qr.isDark(r,c)?' on':''); container.appendChild(cell); }
        return true;
      }
    }catch(e){}
    var N=17;
    container.style.gridTemplateColumns='repeat(17,1fr)'; container.style.gridTemplateRows='repeat(17,1fr)';
    for(var r2=0;r2<N;r2++) for(var c2=0;c2<N;c2++){
      var fin=(r2<5&&c2<5)||(r2<5&&c2>=N-5)||(r2>=N-5&&c2<5), on;
      if(fin){ var ir=r2<5?r2:r2-(N-5), ic=c2<5?c2:c2-(N-5); on=(ir===0||ir===4||ic===0||ic===4||(ir===2&&ic===2)); } else on=Math.random()<0.42;
      var cell2=document.createElement('div'); cell2.className='qr-cell'+(on?' on':''); container.appendChild(cell2);
    }
    return false;
  }
  function runQrSequence(){
    showScreen('screen-qr');
    var real=renderQrCells($('qrGrid'), location.origin);
    $('qrCaption').textContent= real ? 'このQRを仲間が読み取ると、同じゲームがすぐ開きます' : '読み取り中…';
    $('storeReveal').classList.remove('show');
    var done=false;
    function proceed(){ if(done) return; done=true; NET.send({ t:'listTeams' }); showScreen('screen-teamselect'); }
    $('qrSkipBtn').onclick=proceed;
    setTimeout(function(){ $('storeReveal').classList.add('show'); setTimeout(proceed, real?2400:900); }, 1300);
  }

  /* ================= 連選び ================= */
  function miniSvg(k, cls){
    var v=C.VARIANTS[k]||C.VARIANTS.classic, c=cls||'team-mini-svg';
    var base='<ellipse cx="30" cy="52.5" rx="20" ry="2.8" fill="rgba(10,6,24,.4)"/>'+
      '<rect x="7" y="46" width="46" height="3.2" rx="1.6" fill="#1e1838"/><circle cx="7.5" cy="47.6" r="2" fill="#e8c765"/><circle cx="52.5" cy="47.6" r="2" fill="#e8c765"/>';
    var body='<rect x="18" y="27" width="24" height="17" rx="1.5" fill="'+v.svgBody+'" stroke="#a87e22" stroke-width="1"/>'+
      '<rect x="26.5" y="30" width="7" height="11" fill="#e8c765" stroke="#7a5410" stroke-width=".8"/>';
    var roof;
    if(k==='shinmei'){
      roof='<line x1="16" y1="4" x2="22" y2="14" stroke="'+v.svgRoof+'" stroke-width="1.8"/><line x1="22" y1="4" x2="16" y2="14" stroke="'+v.svgRoof+'" stroke-width="1.8"/>'+
        '<line x1="38" y1="4" x2="44" y2="14" stroke="'+v.svgRoof+'" stroke-width="1.8"/><line x1="44" y1="4" x2="38" y2="14" stroke="'+v.svgRoof+'" stroke-width="1.8"/>'+
        '<path d="M30 10 L8 25 L52 25 Z" fill="'+v.svgRoof+'" stroke="#a87e22" stroke-width="1"/>';
    } else if(k==='futon' || k==='chousa'){
      roof='';
      for(var i=0;i<5;i++){ var w=40-i*4; roof+='<rect x="'+(30-w/2)+'" y="'+(22-i*4.4)+'" width="'+w+'" height="4" rx="2" fill="'+v.svgRoof+'" stroke="#6a0e14" stroke-width=".7"/>'; }
      roof+='<circle cx="30" cy="3.6" r="2.4" fill="#f6d878"/>';
    } else if(k==='dashi'){
      roof='<path d="M30 4 C24 5.5 19 9 15 14 Q18 12 20.5 12.2 L30 10.5 L39.5 12.2 Q42 12 45 14 C41 9 36 5.5 30 4 Z" fill="'+v.svgRoof+'" stroke="#dcae48" stroke-width="1"/>'+
        '<rect x="21" y="15" width="18" height="10" rx="1.2" fill="'+v.svgBody+'" stroke="#a87e22" stroke-width="1"/>';
      base='<ellipse cx="30" cy="54" rx="20" ry="2.6" fill="rgba(10,6,24,.4)"/><circle cx="15" cy="48" r="6" fill="#4a3320"/><circle cx="45" cy="48" r="6" fill="#4a3320"/><circle cx="15" cy="48" r="1.8" fill="#e8c765"/><circle cx="45" cy="48" r="1.8" fill="#e8c765"/>';
    } else {
      roof='<circle cx="30" cy="6" r="2.6" fill="#f6d878"/>'+
        '<path d="M30 8 C21 10 13 17 6 26 Q10 22.5 13.5 22.8 L30 19 L46.5 22.8 Q50 22.5 54 26 C47 17 39 10 30 8 Z" fill="'+v.svgRoof+'" stroke="#dcae48" stroke-width="1.2"/>'+
        '<rect x="12" y="23.5" width="36" height="2.6" rx="1.3" fill="#e8c765"/>'+
        '<path d="M13 25 Q9 33 11 39" fill="none" stroke="#e0762a" stroke-width="1.6"/><path d="M47 25 Q51 33 49 39" fill="none" stroke="#e0762a" stroke-width="1.6"/>';
    }
    return '<svg class="'+c+'" viewBox="0 0 60 60">'+base+roof+body+'</svg>';
  }
  var teamGrid=$('teamGrid');
  function buildTeamSelect(){
    teamGrid.innerHTML='';
    var list=state.teamList||[];
    list.forEach(function(team){
      var card=document.createElement('button'); card.type='button';
      card.className='team-card'+(state.selectedTeamId===team.id?' selected':'');
      card.setAttribute('aria-pressed', state.selectedTeamId===team.id?'true':'false');
      card.innerHTML=miniSvg(team.variant)+'<div class="team-card-info"><div class="team-card-name">'+U.escapeHtml(team.name)+'</div>'+
        '<div class="team-card-meta">参加中 '+team.humans+'人・'+(C.VARIANTS[team.variant]||C.VARIANTS.classic).label+'の神輿・格'+((team.level||0)+1)+'</div></div>'+
        '<span class="team-card-badge">参加する</span>';
      card.onclick=function(){ tick(); state.selectedTeamId=team.id; state.selectedCreate=false; buildTeamSelect(); };
      teamGrid.appendChild(card);
    });
    if(!list.length){
      var empty=document.createElement('div'); empty.className='team-card'; empty.style.justifyContent='center';
      empty.innerHTML='<div class="team-card-meta">いま募集中の連はありません。新しく旗揚げしましょう！</div>';
      teamGrid.appendChild(empty);
    }
    var custom=document.createElement('div');
    custom.className='team-card custom-team-card'+(state.selectedCreate?' selected':'');
    custom.innerHTML='<div class="team-card-info" style="width:100%;"><div class="team-card-name">新しい連を旗揚げする</div>'+
      '<input type="text" id="customTeamInput" maxlength="10" placeholder="連の名前を入力">'+
      '<div class="variant-row">'+Object.keys(C.VARIANTS).map(function(k){
        return '<button type="button" class="variant-chip'+(state.customVariant===k?' sel':'')+'" data-v="'+k+'" aria-pressed="'+(state.customVariant===k)+'">'+miniSvg(k,'')+C.VARIANTS[k].label+'</button>';
      }).join('')+'</div><div class="team-card-meta" style="margin-top:6px;">仲間はあとから同じ連に参加できます（最大16人）</div></div>';
    teamGrid.appendChild(custom);
    var input=$('customTeamInput');
    input.value=state.customTeamName||'';
    input.addEventListener('focus', function(){ state.selectedCreate=true; state.selectedTeamId=null; markSelected(); });
    input.addEventListener('input', function(){ state.customTeamName=input.value; });
    Array.prototype.forEach.call(custom.querySelectorAll('.variant-chip'), function(btn){
      btn.onclick=function(){ tick(); state.customVariant=btn.dataset.v; state.selectedCreate=true; state.selectedTeamId=null; buildTeamSelect(); };
    });
  }
  function markSelected(){
    var cards=teamGrid.querySelectorAll('.team-card');
    Array.prototype.forEach.call(cards, function(c){ c.classList.remove('selected'); });
    if(state.selectedCreate && cards.length) cards[cards.length-1].classList.add('selected');
  }
  $('teamConfirmBtn').addEventListener('click', function(){
    A.select();
    if(state.selectedCreate || !state.selectedTeamId) NET.send({ t:'createTeam', name:(state.customTeamName||'').trim(), variant:state.customVariant });
    else NET.send({ t:'joinTeam', id:state.selectedTeamId });
  });
  $('teamRefreshBtn').addEventListener('click', function(){ tick(); NET.send({ t:'listTeams' }); });
  $('teamMypageBtn').addEventListener('click', function(){ tick(); showMyPage(); });

  /* ================= 控室 ================= */
  function renderLobby(msg){
    state.roomId=msg.roomId; state.teamName=msg.name; state.variant=msg.variant;
    state.level=msg.level||0; state.streak=msg.streak||0; state.members=msg.members||[]; state.botFill=msg.botFill||0;
    $('lobbyTeamName').textContent=msg.name;
    $('lobbySize').textContent=state.members.length+state.botFill;
    $('lobbyLevel').textContent=['壱','弐','参','肆','伍'][Math.min(4,state.level)];
    var box=$('lobbyMembers'); box.innerHTML='';
    state.members.forEach(function(mb){
      var d=document.createElement('span'); d.className='member-chip'+(mb.ready?' ready':'');
      d.textContent=mb.name+(mb.pid===state.pid?'（あなた）':'')+(mb.ready?' ✓':''); box.appendChild(d);
    });
    if(state.botFill>0){ var b=document.createElement('span'); b.className='member-chip bot'; b.textContent='助っ人 '+state.botFill+'人'; box.appendChild(b); }
    var st=$('lobbyStreak');
    st.textContent=state.streak>0?('勝ち進み中・次は'+C.TOUR_LABEL[Math.min(state.streak,2)]):'';
    st.classList.toggle('hidden', !(state.streak>0));
    var meReady=state.members.some(function(mb){ return mb.pid===state.pid && mb.ready; });
    var btn=$('lobbyReadyBtn');
    btn.disabled=meReady; btn.textContent=meReady?'仲間の準備を待っています…':'準備完了（相手を探す）';
    /* 控室に戻った知らせ（status が lobby）なら、勝利後の「次の対戦へ」の受付は終わっている */
    var back=(msg.status===undefined || msg.status==='lobby');
    if(back) state.continueUntil=0;
    var a=activeScreen();
    if(a==='screen-teamselect' || a==='screen-qr') showScreen('screen-lobby');
    else if(a==='screen-mypage') updateMypageRetry();
    else if(a==='screen-result' && back) resultBackToLobby();
    /* 「次の相手を探しています…」の最中に控室へ戻された（受付の締切ぎりぎりに押した等）なら控室を出す。
     * 試合中・結果待ちはこの表示が出ていないので切り替わらない */
    else if(a==='screen-match' && back && !hud.searching.classList.contains('hidden')){ hud.searching.classList.add('hidden'); showScreen('screen-lobby'); }
  }
  $('lobbyReadyBtn').addEventListener('click', function(){ A.init(); A.select(); state.needAd=true; NET.send({ t:'ready' }); });
  $('lobbyLeaveBtn').addEventListener('click', function(){ tick(); NET.send({ t:'leaveTeam' }); state.roomId=null; NET.send({ t:'listTeams' }); showScreen('screen-teamselect'); });
  $('lobbyQrBtn').addEventListener('click', function(){
    if(!state.roomId) return;
    renderQrCells($('lobbyQrGrid'), location.origin+'/?team='+encodeURIComponent(state.roomId));
    $('lobbyQrModal').classList.remove('hidden');
    try{ $('lobbyQrCloseBtn').focus(); }catch(e){}
  });
  function closeLobbyQr(){ $('lobbyQrModal').classList.add('hidden'); try{ $('lobbyQrBtn').focus(); }catch(e){} }
  $('lobbyQrCloseBtn').addEventListener('click', closeLobbyQr);
  $('lobbyQrModal').addEventListener('keydown', function(e){ if(e.key==='Escape') closeLobbyQr(); });

  /* ================= 広告（試合前だけ） ================= */
  var adFinish=null;
  function startAd(onDone){
    showScreen('screen-ad');
    var sp=U.pick(C.AD_SPONSORS), cv=$('adCanvas'), cx=cv.getContext && cv.getContext('2d');
    var t0=performance.now(), dur=15000, done=false, raf=null, fill=$('adProgressFill'), skip=$('adSkipBtn');
    skip.classList.add('hidden');
    fill.style.transition='none'; fill.style.width='0%'; void fill.offsetWidth;
    fill.style.transition='width '+dur+'ms linear'; fill.style.width='100%';
    function draw(el){
      if(!cx || !cx.createLinearGradient) return;
      var w=cv.width, h=cv.height, g=cx.createLinearGradient(0,0,0,h);
      g.addColorStop(0,sp.bgTop); g.addColorStop(1,sp.bgBottom); cx.fillStyle=g; cx.fillRect(0,0,w,h);
      cx.fillStyle=sp.vessel; cx.fillRect(w*0.38,h*0.3,w*0.24,h*0.5); cx.fillRect(w*0.45,h*0.18,w*0.1,h*0.14);
      for(var i=0;i<6;i++){ var y=h-((el*0.06+i*40)%(h*0.8)); cx.fillStyle='rgba(255,255,255,0.5)'; cx.beginPath(); cx.arc(w*(0.42+i*0.03),y,2.5,0,Math.PI*2); cx.fill(); }
      cx.fillStyle='#fff'; cx.font='bold 22px sans-serif'; cx.textAlign='center'; cx.fillText(sp.name, w/2, h*0.14);
      cx.font='12px sans-serif'; cx.fillText(sp.tagline, w/2, h*0.9);
      cx.fillStyle='rgba(0,0,0,0.55)'; cx.fillRect(w-46,8,38,20); cx.fillStyle='#fff'; cx.font='bold 12px sans-serif'; cx.fillText('AD', w-27, 22);
    }
    function frame(now){
      var el=now-t0; draw(el);
      if(el>=5000) skip.classList.remove('hidden');
      if(el>=dur){ finish(); return; }
      raf=requestAnimationFrame(frame);
    }
    function finish(){ if(done) return; done=true; adFinish=null; cancelAnimationFrame(raf); onDone(); }
    adFinish=finish;
    skip.onclick=finish;
    raf=requestAnimationFrame(frame);
  }

  /* ================= 試合 ================= */
  var laneCv=$('laneCanvas'), laneCx=laneCv.getContext && laneCv.getContext('2d');
  var hud={
    youScore:$('youScore'), enemyScore:$('enemyScore'), youName:$('youName'), enemyName:$('enemyName'),
    tugFill:$('tugFill'), tugKnot:$('tugKnot'), syncFill:$('syncFill'), combo:$('comboLabel'),
    round:$('roundChip'), tempo:$('tempoChip'), tour:$('tourChip'), callout:$('callout'),
    clashCard:$('clashCard'), clashJudge:$('clashJudge'), clashDetail:$('clashDetail'), clashPts:$('clashPts'),
    dots:$('teamDots'), hint:$('tapHint'), marker:$('selfMarker'), searching:$('searchingOverlay'), vs:$('vsBanner')
  };
  var calloutTimer=null;
  function callout(text, cls, holdMs, sub){
    var el=hud.callout;
    el.className='callout'+(cls?' '+cls:'');
    if(cls==='small') el.setAttribute('aria-hidden','true'); else el.removeAttribute('aria-hidden');
    el.innerHTML=U.escapeHtml(text)+(sub?'<span class="sub">'+U.escapeHtml(sub)+'</span>':'');
    void el.offsetWidth; el.classList.add('show');
    clearTimeout(calloutTimer);
    calloutTimer=setTimeout(function(){ el.classList.add('fade'); }, holdMs||700);
  }
  function newMatch(msg){
    var m={
      you:msg.you, enemy:msg.enemy, tour:msg.tour||0, rounds:[], round:null, youPower:0, enemyPower:0,
      myHits:0, myGood:0, myClash:0, battle:null, settle:null, battleAt:0, arena:null, pops:[], rings:[], timers:[]
    };
    return m;
  }
  function clearMatchTimers(m){ if(!m) return; m.timers.forEach(clearTimeout); m.timers=[]; }
  function buildDots(m){
    hud.dots.innerHTML='';
    var size=m.you.size||8, members=m.you.members||[];
    var ids=members.map(function(x){ return x.pid; });
    for(var b=0; ids.length<size; b++) ids.push('b'+b);
    m.dotEls={};
    ids.forEach(function(id){
      var d=document.createElement('span'); d.className='dot'+(id===myId()?' me':'');
      hud.dots.appendChild(d); m.dotEls[id]=d;
    });
  }
  function flashDot(m, id){
    var d=m && m.dotEls && m.dotEls[id]; if(!d) return;
    d.classList.add('hit'); setTimeout(function(){ d.classList.remove('hit'); }, 160);
  }
  function setScores(m, you, enemy){
    m.youPower=you; m.enemyPower=enemy;
    hud.youScore.textContent=Math.round(you); hud.enemyScore.textContent=Math.round(enemy);
    var push=U.clamp((you-enemy)/40,-1,1);
    var pct=50+push*46;
    hud.tugFill.style.width=pct+'%'; hud.tugKnot.style.left=pct+'%';
    if(m.arena) m.arena.setPush(push);
  }
  function onMatched(msg){
    clearMatchTimers(state.match);
    stopResultCountdown(); state.continueUntil=0;
    state.match=newMatch(msg);
    state.streak=msg.tour||0;
    hud.searching.classList.add('hidden');
    if(state.needAd && !state.practice){ state.needAd=false; startAd(enterArena); }
    else enterArena();
  }
  function enterArena(){
    var m=state.match; if(!m || m.entered) return;
    m.entered=true;
    showScreen('screen-match');
    hud.youName.textContent=m.you.name; hud.enemyName.textContent=m.enemy.name;
    hud.tour.textContent=state.practice?'稽古':C.TOUR_LABEL[Math.min(m.tour,2)];
    $('matchQuitBtn').classList.toggle('hidden', !state.practice);
    hud.round.textContent='入場'; hud.tempo.textContent='♩=—';
    hud.combo.textContent=''; hud.syncFill.style.width='0%';
    hud.clashCard.classList.add('hidden');
    hud.hint.textContent='太鼓の音符が輪に重なる瞬間、画面のどこでもタップ！';
    setScores(m, 0, 0);
    buildDots(m);
    var members=m.you.members||[];
    var selfIndex=-1; members.forEach(function(x,i){ if(x.pid===myId()) selfIndex=i; });
    var items=Object.keys(state.equipped).map(C.catalogByKey).filter(Boolean);
    if(STAGE.ready || STAGE.init($('threeCanvas'))){
      m.arena=STAGE.showMatch({
        you:{ name:m.you.name, variant:m.you.variant, level:m.you.level||0, members:members, selfIndex:selfIndex, selfItems:items },
        enemy:{ name:m.enemy.name, variant:m.enemy.variant, level:m.enemy.level||0, members:m.enemy.members||[] }
      });
    }
    $('vsYou').textContent=m.you.name; $('vsEnemy').textContent=m.enemy.name;
    hud.vs.classList.remove('hidden'); hud.vs.classList.remove('show'); void hud.vs.offsetWidth; hud.vs.classList.add('show');
    m.timers.push(setTimeout(function(){ hud.vs.classList.add('hidden'); }, 2600));
    A.setCrowd(0.8); A.cheer(0, 2, 0.5);
    startLane();
    TX.send({ t:'arena' });
  }

  /* ---- 1番の予定を組む ---- */
  function onRound(msg){
    var m=state.match; if(!m) return;
    /* 再接続で同じ番が送り直されたときは組み直さない（太鼓が二重に鳴るのを防ぐ） */
    if(m.round && m.round.r===msg.r && m.round.startAt===msg.startAt) return;
    if(adFinish) adFinish();               /* 広告の途中で番が始まったら広告を閉じて入場 */
    if(!m.entered) enterArena();
    if(activeScreen()!=='screen-match'){ rawShow('screen-match'); }
    hud.vs.classList.add('hidden');
    hud.clashCard.classList.add('hidden');
    hud.searching.classList.add('hidden');
    if(m.round && m.round.timers) m.round.timers.forEach(clearTimeout);
    var R={
      r:msg.r, beatMs:msg.beatMs, beats:msg.beats, countIn:msg.countIn, clashIdx:msg.beats+2,
      startAt:msg.startAt, startPerf:perfOf(msg.startAt), hitWindow:msg.hitWindow||C.HIT_WINDOW_MS, tapped:{}, notes:[], clashDone:false, beatRes:[],
      timers:[], helpers:(msg.botTaps||[]).length, helperDone:{}, anyTap:false
    };
    R.clashPerf=R.startPerf+R.clashIdx*R.beatMs;
    m.round=R;
    var bpm=Math.round(60000/R.beatMs);
    hud.round.textContent=C.ROUND_LABEL[Math.min(R.r-1,2)]; hud.tempo.textContent='♩='+bpm;
    callout(C.ROUND_LABEL[Math.min(R.r-1,2)], '', 900, R.r>1?'テンポが上がる！ ♩='+bpm:'♩='+bpm+' 太鼓に合わせて担げ');
    /* 譜面 */
    for(var k=0;k<R.countIn;k++) R.notes.push({ kind:'count', t:R.startPerf-(R.countIn-k)*R.beatMs, k:k });
    for(var i=0;i<R.beats;i++) R.notes.push({ kind:'beat', t:R.startPerf+i*R.beatMs, i:i });
    R.notes.push({ kind:'se', t:R.startPerf+R.beats*R.beatMs });
    R.notes.push({ kind:'no', t:R.startPerf+(R.beats+1)*R.beatMs });
    R.notes.push({ kind:'clash', t:R.clashPerf });
    /* 音: 拍子木の前打ち → 太鼓 → 笛と声の「せー・の」 → 無音の「！」
     * 「音のタイミング調整」(off) は音と見た目の合図だけを早める。タップの判定・送信の基準は R.startPerf のまま */
    var off=A.offset();
    function at(perfT, fn){ var d=perfT-performance.now(), id=setTimeout(fn, Math.max(0,d)); m.timers.push(id); R.timers.push(id); }
    /* 再接続では 'matched' で試合を組み直してから同じ番が届く（m.round は空）。見た目は組み直すが、
     * 前に予約した太鼓はまだ鳴る予定なので、同じ番の音は予約し直さない */
    var audioKey=R.r+':'+R.startAt;
    if(A.ready() && audioKey!==lastAudioKey){
      lastAudioKey=audioKey;
      R.notes.forEach(function(n){
        var t=acAt(n.t); if(t<A.now()) return;
        if(n.kind==='count'){ A.hyoshigi(t); }
        else if(n.kind==='beat'){ A.don(t, n.i%2?0.8:1.0); if(n.i%2) A.ka(acAt(n.t+R.beatMs/2), 0.6); }
        else if(n.kind==='se'){ A.voice(t,'e',R.beatMs/1000*0.8,170); A.whistle(t, 0.12, 2900, 0.12); }
        else if(n.kind==='no'){ A.voice(t,'o',R.beatMs/1000*0.5,160); A.whistle(t, 0.1, 3100, 0.12); }
      });
    }
    var ar=m.arena;
    if(ar) ar.setRhythm(true, R.startPerf-off, R.beatMs);
    R.notes.forEach(function(n){
      if(n.kind==='count') at(n.t-off, function(){ callout(String(R.countIn-n.k), 'small', 300); });
      if(n.kind==='se') at(n.t-off, function(){ callout('せー', '', R.beatMs*0.8); if(ar) ar.clashCue('se'); hud.hint.textContent='太鼓が止まった！「！」で全員いっせいに'; });
      if(n.kind==='no') at(n.t-off, function(){ callout('の', '', R.beatMs*0.8); if(ar) ar.clashCue('no'); });
      if(n.kind==='clash') at(n.t-off, function(){ if(ar){ ar.clashCue('go'); ar.setRhythm(false); } });
    });
    /* 仲間の助っ人の動き（見た目）。自分が叩いた拍は自分に寄せる（followTap）。叩かなかった拍は届いた予定どおり */
    (msg.botTaps||[]).forEach(function(plan, k){
      plan.forEach(function(d, i){
        if(d===null || d===undefined) return;
        var slot=i<R.beats?i:'c', base=i<R.beats?R.startPerf+i*R.beatMs:R.clashPerf;
        at(base+d, function(){ helperPlanTap(m, R, k, slot, base); });
      });
    });
    (msg.enemyTaps||[]).forEach(function(plan, k){
      plan.forEach(function(d, i){
        if(d===null || d===undefined) return;
        var base=i<R.beats?R.startPerf+i*R.beatMs:R.clashPerf;
        if(ar) ar.B.scheduleTap('b'+k, base+d);
      });
    });
    at(R.startPerf-R.countIn*R.beatMs-50, function(){ hud.hint.textContent='太鼓の音符が輪に重なる瞬間、画面のどこでもタップ！'; });
  }
  /* ---- 助っ人の見た目 ----
   * サーバーは「助っ人は人間のズレに寄せて叩く」。画面も同じく、自分が叩いた拍では自分のタップ時刻＋各人 N(0,25ms) で動かす。
   * 前の拍を叩いていれば次の拍も叩くと見て、予定の動きは自分の一打まで待たせる（受付が閉じても叩かなければ予定どおり動かす） */
  function followMode(R, slot){ if(slot==='c') return R.anyTap; if(slot===0) return true; return !!R.tapped[slot-1]; }
  function helperTap(m, k, t){
    if(m.arena) m.arena.A.scheduleTap('b'+k, t);
    var wait=t-performance.now();
    if(wait>0) m.timers.push(setTimeout(function(){ flashDot(m, 'b'+k); }, wait)); else flashDot(m, 'b'+k);
  }
  function helperPlanTap(m, R, k, slot, base){
    if(state.match!==m || m.round!==R) return;
    var key=slot+':'+k;
    if(R.helperDone[key] || R.tapped[slot]) return;
    if(followMode(R, slot)){
      var id=setTimeout(function(){
        if(state.match!==m || m.round!==R || R.helperDone[key] || R.tapped[slot]) return;
        R.helperDone[key]=true; helperTap(m, k, performance.now());
      }, Math.max(0, base+R.hitWindow+20-performance.now()));
      m.timers.push(id); R.timers.push(id);
      return;
    }
    R.helperDone[key]=true; helperTap(m, k, performance.now());
  }
  function followTap(m, R, slot, now){
    R.anyTap=true;
    for(var k=0;k<R.helpers;k++){
      var key=slot+':'+k;
      if(R.helperDone[key]) continue;
      R.helperDone[key]=true;
      if(Math.random()<0.03) continue; /* たまに叩き損ねる */
      helperTap(m, k, now+U.randomNormal(0,25));
    }
  }

  /* ---- タップ ---- */
  function onTapInput(ev){
    var m=state.match; if(!m || !m.round) return;
    if(ev && ev.target && ev.target.closest && ev.target.closest('button')) return;
    if(ev && ev.cancelable) ev.preventDefault();
    A.init();
    var R=m.round, now=performance.now(), rel=now-R.startPerf;
    var idx=Math.round(rel/R.beatMs), d=rel-idx*R.beatMs;
    var slot=null;
    if(idx>=0 && idx<R.beats) slot=idx;
    else if(idx===R.clashIdx) slot='c';
    else if(idx===R.beats || idx===R.beats+1){ pop('待て', '#ffb080'); return; }
    else if(rel<0){ pop('まだ', '#a9a3c9'); return; }
    else return;
    if(Math.abs(d)>R.hitWindow){ pop('空', '#8e8aa8'); return; }
    if(R.tapped[slot]) return;
    R.tapped[slot]=true;
    /* 送る時刻は番の基準から計算する（途中で時計合わせが更新されても画面の判定とずれない）。音のタイミング調整は含めない */
    TX.send({ t:'tap', r:R.r, at:Math.round(R.startAt+(now-R.startPerf)) });
    followTap(m, R, slot, now);
    var g=SC.gradeOf(d);
    pop(slot==='c'?'！':g.label, g.color, slot==='c');
    ring(g.color);
    if(slot==='c'){ m.myClashLocal=d; } else { m.myHits++; if(g.w>=0.7) m.myGood++; }
    flashDot(m, myId());
    if(m.arena && m.arena.A.selfCarrier) m.arena.A.tapNow(m.arena.A.selfCarrier.slot);
    if(A.ready()) A.ka(0, 0.35);
    if(navigator.vibrate && !MK.reduceMotion) try{ navigator.vibrate(slot==='c'?30:12); }catch(e){}
  }
  $('screen-match').addEventListener('pointerdown', onTapInput);
  document.addEventListener('keydown', function(e){
    if(activeScreen()!=='screen-match' || modalOpen()) return;
    if(e.target && e.target.closest && e.target.closest('button')) return; /* ボタン上の Enter はボタンの操作 */
    if(e.code==='Space' || e.code==='Enter' || e.key===' '){ e.preventDefault(); if(!e.repeat) onTapInput(null); }
  });
  /* 稽古だけ、試合の途中でやめられる */
  $('matchQuitBtn').addEventListener('click', function(){ tick(); if(!state.practice) return; leavePractice(); enterTitle(); });
  function onTapped(msg){
    var m=state.match; if(!m) return;
    if(msg.side==='enemy'){ if(m.arena) m.arena.B.scheduleTap('e'+msg.ei, performance.now()); return; }
    if(msg.pid===myId()) return;
    flashDot(m, msg.pid);
    if(m.arena) m.arena.A.scheduleTap(msg.pid, performance.now());
  }

  /* ---- 拍ごとの結果（サーバーから） ---- */
  function onBeat(msg){
    var m=state.match; if(!m || !m.round || msg.r!==m.round.r) return;
    setScores(m, msg.you.power, msg.enemy.power);
    hud.syncFill.style.width=Math.round(U.clamp01(msg.you.sync)*100)+'%';
    var combo=msg.you.combo||0;
    if(combo>=2){ hud.combo.textContent='勢い ×'+combo; hud.combo.classList.remove('hot'); void hud.combo.offsetWidth; hud.combo.classList.add('hot'); }
    else hud.combo.textContent='';
    if(m.arena) m.arena.beatResult(msg.you.pts, msg.enemy.pts, combo, msg.enemy.combo||0);
    if(msg.me && msg.me.synced && m.dotEls && m.dotEls[myId()]){ var d=m.dotEls[myId()]; d.classList.add('synced'); setTimeout(function(){ d.classList.remove('synced'); }, 300); }
    if(m.round.tapped[msg.i] && !msg.me) pop('届かず', '#a9a3c9');
    m.round.beatRes.push(msg);
  }
  /* ---- ぶつけの結果 ---- */
  function onRoundResult(msg){
    var m=state.match; if(!m) return;
    var R=m.round||{ r:msg.r };
    R.clashDone=true;
    setScores(m, msg.power, msg.enemyPower);
    var J=C.judgementByKey(msg.judgement);
    var win=msg.clashPts>=msg.enemyClashPts?'A':'B';
    var strength=U.clamp01(Math.abs(msg.clashPts-msg.enemyClashPts)/25);
    if(m.arena) m.arena.clashResult(win, strength, msg.judgement);
    else if(A.ready()) A.impact(0, 0.8);
    hud.clashJudge.textContent=J.label; hud.clashJudge.style.color=J.color;
    var me=msg.me||{};
    hud.clashDetail.textContent='連の揃い '+msg.best+' / '+msg.teamSize+'人　'+(me.clashD!==null && me.clashD!==undefined ? ('あなた '+(me.clashD>=0?'+':'')+me.clashD+'ms'+(me.clashSynced?' ✓':'')) : 'あなたは叩けず');
    hud.clashPts.textContent=(win==='A'?'押し勝ち！ ':'押し負け… ')+'+'+msg.clashPts+'（相手 +'+msg.enemyClashPts+'）';
    hud.clashCard.classList.remove('hidden');
    if(msg.judgement==='MIRACLE'||msg.judgement==='PERFECT'){ A.sparkle(); A.cheer(0,1.8,0.8); }
    if(me.clashSynced) m.myClash++;
    /* 振り返り用: 自分の拍ごとのズレ（beat の me）と、ぶつけのズレ */
    var nb=R.beats||C.BEATS, marks=[];
    for(var bi=0;bi<nb;bi++) marks.push(null);
    (R.beatRes||[]).forEach(function(b){ if(b.i>=0 && b.i<nb && b.me && isFinite(b.me.d)) marks[b.i]={ d:+b.me.d, g:b.me.g }; });
    var cg=(me.clashD!==null && me.clashD!==undefined && isFinite(me.clashD))?SC.gradeOf(+me.clashD):null;
    marks.push(cg?{ d:+me.clashD, g:cg.key }:null);
    m.rounds.push({ r:msg.r, you:msg.clashPts, enemy:msg.enemyClashPts, j:msg.judgement, ej:msg.enemyJudgement,
      youTotal:msg.power, enemyTotal:msg.enemyPower, hits:me.hits, goods:me.goods, marks:marks });
    hud.combo.textContent='';
    m.timers.push(setTimeout(function(){ hud.clashCard.classList.add('hidden'); }, 2300));
  }
  /* ---- 決着 ---- */
  function onBattle(msg){
    var m=state.match; if(!m) return;
    m.battle=msg; m.battleAt=performance.now();
    setScores(m, msg.yourPower, msg.enemyPower);
    if(m.arena){ m.arena.setRhythm(false); m.arena.finale(msg.win); }
    callout(msg.win?'勝鬨！':'無念…', msg.win?'huge':'', 2600, Math.round(msg.yourPower)+' 対 '+Math.round(msg.enemyPower));
    A.fanfare(msg.win);
    A.setCrowd(msg.win?1:0.5);
    hud.hint.textContent='';
  }
  function onSettle(msg){
    var m=state.match; if(!m) return;
    m.settle=msg;
    if(!state.practice){ /* 稽古はオンラインの記録を変えない */
      state.coins=msg.coins; state.level=msg.level||0; state.streak=msg.streak||0;
      if(msg.win) state.wins++;
      /* 勝ち進んだら「次の対戦へ」を押せる残り時間を数える（サーバーが時間を送ってくればそれを使う） */
      state.continueUntil=msg.outcome==='continue'?performance.now()+(+msg.continueMs>0?+msg.continueMs:CONTINUE_MS):0;
    }
    var wait=Math.max(0, 4200-(performance.now()-m.battleAt));
    m.timers.push(setTimeout(function(){ showResult(m); }, wait));
  }

  /* ---- 太鼓の譜面レーン ---- */
  var laneRaf=null;
  function pop(text, color, big){
    var m=state.match; if(!m) return;
    m.pops.push({ text:text, color:color, t:performance.now(), big:!!big });
  }
  function ring(color){ var m=state.match; if(m) m.rings.push({ color:color, t:performance.now() }); }
  function startLane(){
    if(laneRaf) return;
    function frame(){
      laneRaf=requestAnimationFrame(frame);
      if(activeScreen()!=='screen-match'){ return; }
      drawLane();
      var m=state.match;
      if(m && m.arena && m.arena.selfScreen){
        var p=m.arena.selfScreen();
        if(p && p.visible && m.arena.cam==='play'){ hud.marker.classList.remove('hidden'); hud.marker.style.left=p.x+'px'; hud.marker.style.top=p.y+'px'; }
        else hud.marker.classList.add('hidden');
      }
    }
    laneRaf=requestAnimationFrame(frame);
  }
  function drawLane(){
    if(!laneCx || !laneCx.clearRect) return;
    var dpr=Math.min(2, window.devicePixelRatio||1);
    var W=laneCv.clientWidth||360, Hh=laneCv.clientHeight||112;
    if(laneCv.width!==Math.round(W*dpr)){ laneCv.width=Math.round(W*dpr); laneCv.height=Math.round(Hh*dpr); }
    var cx=laneCx; cx.setTransform(dpr,0,0,dpr,0,0); cx.clearRect(0,0,W,Hh);
    var m=state.match, R=m&&m.round, now=performance.now();
    var y=Hh*0.52, hitX=W*0.17, laneH=58;
    /* 帯 */
    var g=cx.createLinearGradient(0,y-laneH/2,0,y+laneH/2);
    g.addColorStop(0,'rgba(40,24,30,0.85)'); g.addColorStop(0.5,'rgba(70,36,32,0.85)'); g.addColorStop(1,'rgba(40,24,30,0.85)');
    cx.fillStyle=g; roundRect(cx, 4, y-laneH/2, W-8, laneH, 14); cx.fill();
    cx.strokeStyle='rgba(224,182,84,0.55)'; cx.lineWidth=1.5; roundRect(cx, 4, y-laneH/2, W-8, laneH, 14); cx.stroke();
    /* 判定の輪（太鼓の面） */
    /* 音のタイミング調整(off)のぶん、音符と輪の脈打ちも早める（音と見た目を揃える。判定の基準は変えない） */
    var off=A.offset(), vnow=now+off;
    var pulse=0;
    if(R){ var bp=(vnow-R.startPerf)/R.beatMs; if(bp>-R.countIn-0.2 && bp<R.clashIdx+0.5){ var fr=bp-Math.round(bp); pulse=Math.max(0,1-Math.abs(fr)*5); } }
    cx.beginPath(); cx.arc(hitX,y,27+pulse*3,0,Math.PI*2); cx.fillStyle='rgba(247,236,210,'+(0.12+pulse*0.2)+')'; cx.fill();
    cx.lineWidth=3; cx.strokeStyle='rgba(249,230,160,0.95)'; cx.stroke();
    cx.beginPath(); cx.arc(hitX,y,19,0,Math.PI*2); cx.lineWidth=1.5; cx.strokeStyle='rgba(249,230,160,0.5)'; cx.stroke();
    if(!R){ drawPops(cx, hitX, y, now); return; }
    var pxPerMs=(W-hitX-10)/(R.beatMs*2.6);
    /* 音符 */
    for(var i=R.notes.length-1;i>=0;i--){
      var n=R.notes[i], x=hitX+(n.t-vnow)*pxPerMs;
      if(x>W+30 || x<-40) continue;
      var passed=n.t<vnow-R.hitWindow, alpha=passed?Math.max(0,1-(vnow-n.t-R.hitWindow)/250):1;
      if(alpha<=0) continue;
      cx.globalAlpha=alpha;
      if(n.kind==='count'){
        cx.beginPath(); cx.arc(x,y,6,0,Math.PI*2); cx.fillStyle='rgba(247,240,222,0.55)'; cx.fill();
      } else if(n.kind==='beat'){
        var hit=R.tapped[n.i];
        cx.beginPath(); cx.arc(x,y,18,0,Math.PI*2);
        var ng=cx.createRadialGradient(x-5,y-6,2,x,y,18); ng.addColorStop(0,hit?'#ffe9b0':'#ff8a64'); ng.addColorStop(1,hit?'#c9962e':'#c72d17');
        cx.fillStyle=ng; cx.fill(); cx.lineWidth=2.5; cx.strokeStyle='#fff4e0'; cx.stroke();
        cx.font='bold 13px sans-serif'; cx.textAlign='center'; cx.textBaseline='middle';
        /* 明るい地でも読めるよう暗い縁取りを付ける */
        cx.lineWidth=3.5; cx.strokeStyle='rgba(42,12,4,0.9)'; cx.strokeText('ドン', x, y+1);
        cx.fillStyle='#fff'; cx.fillText('ドン', x, y+1);
      } else if(n.kind==='se' || n.kind==='no'){
        cx.beginPath(); cx.arc(x,y,15,0,Math.PI*2); cx.lineWidth=2; cx.setLineDash([4,3]); cx.strokeStyle='rgba(169,196,255,0.9)'; cx.stroke(); cx.setLineDash([]);
        cx.fillStyle='#cfe0ff'; cx.font='bold 13px serif'; cx.textAlign='center'; cx.textBaseline='middle';
        cx.fillText(n.kind==='se'?'せー':'の', x, y+1);
      } else if(n.kind==='clash'){
        var r2=24+Math.sin(now/90)*1.5;
        cx.beginPath(); cx.arc(x,y,r2,0,Math.PI*2);
        var cg=cx.createRadialGradient(x-6,y-7,3,x,y,r2); cg.addColorStop(0,'#fff6c8'); cg.addColorStop(0.6,'#f0c040'); cg.addColorStop(1,'#a8701a');
        cx.fillStyle=cg; cx.fill(); cx.lineWidth=3; cx.strokeStyle='#fff'; cx.stroke();
        cx.fillStyle='#5a2a06'; cx.font='bold 24px serif'; cx.textAlign='center'; cx.textBaseline='middle'; cx.fillText('！', x, y+1);
      }
      cx.globalAlpha=1;
    }
    drawPops(cx, hitX, y, now);
  }
  function drawPops(cx, hitX, y, now){
    var m=state.match; if(!m) return;
    m.rings=m.rings.filter(function(r){ return now-r.t<320; });
    m.rings.forEach(function(r){
      var k=(now-r.t)/320;
      cx.beginPath(); cx.arc(hitX,y,27+k*26,0,Math.PI*2); cx.lineWidth=4*(1-k); cx.strokeStyle=r.color; cx.globalAlpha=1-k; cx.stroke(); cx.globalAlpha=1;
    });
    m.pops=m.pops.filter(function(p){ return now-p.t<520; });
    m.pops.forEach(function(p){
      var k=(now-p.t)/520;
      cx.globalAlpha=1-k*k;
      cx.fillStyle=p.color; cx.font='bold '+(p.big?34:26)+'px serif'; cx.textAlign='center'; cx.textBaseline='middle';
      cx.shadowColor='rgba(0,0,0,0.8)'; cx.shadowBlur=6;
      cx.fillText(p.text, hitX, y-40-k*14);
      cx.shadowBlur=0; cx.globalAlpha=1;
    });
  }
  function roundRect(cx, x, y, w, h, r){ cx.beginPath(); cx.moveTo(x+r,y); cx.arcTo(x+w,y,x+w,y+h,r); cx.arcTo(x+w,y+h,x,y+h,r); cx.arcTo(x,y+h,x,y,r); cx.arcTo(x,y,x+w,y,r); cx.closePath(); }

  /* ================= 結果 ================= */
  function showResult(m){
    var s=m.settle||{}, b=m.battle||{};
    var outcome=state.practice?'practice':s.outcome;
    var head={ continue:'勝利！', champion:'優勝！！', eliminated:'敗退…', practice:b.win?'稽古・勝ち！':'稽古・負け' }[outcome]||'試合終了';
    $('resultHeadline').textContent=head;
    $('resultEyebrow').textContent=state.practice?'稽古の結果':(C.TOUR_LABEL[Math.min(m.tour,2)]+'の結果');
    $('resultSub').textContent=m.you.name+' 対 '+m.enemy.name;
    var rows='<tr><th>番</th><th>ぶつけ（自）</th><th>自分の連</th><th>相手</th><th>ぶつけ（相）</th></tr>';
    m.rounds.forEach(function(r){
      rows+='<tr><td>'+C.ROUND_LABEL[r.r-1]+'</td><td>'+C.judgementByKey(r.j).label+'</td><td class="you">'+Math.round(r.youTotal)+'</td><td class="enemy">'+Math.round(r.enemyTotal)+'</td><td>'+C.judgementByKey(r.ej).label+'</td></tr>';
    });
    rows+='<tr class="total"><td>計</td><td></td><td class="you">'+Math.round(b.yourPower||m.youPower)+'</td><td class="enemy">'+Math.round(b.enemyPower||m.enemyPower)+'</td><td></td></tr>';
    $('scoreTable').innerHTML=rows;
    var total=C.BEATS*Math.max(1,m.rounds.length);
    var hits=0, goods=0; m.rounds.forEach(function(r){ hits+=r.hits||0; goods+=r.goods||0; });
    $('myStats').innerHTML=
      '<div class="cell panel"><div class="num gold-text">'+hits+'<span style="font-size:13px">/'+total+'</span></div><div class="lbl">叩いた拍</div></div>'+
      '<div class="cell panel"><div class="num gold-text">'+goods+'</div><div class="lbl">極・良</div></div>'+
      '<div class="cell panel"><div class="num gold-text">'+m.myClash+'<span style="font-size:13px">/'+m.rounds.length+'</span></div><div class="lbl">ぶつけで揃った</div></div>';
    var board=b.board||[];
    $('board').innerHTML=board.length?('<div class="review-head"><span>連の中の貢献</span></div>'+
      board.map(function(x,i){ return '<div class="board-row'+(x.pid===state.pid?' me':'')+'"><span>'+(i+1)+'. '+U.escapeHtml(x.name)+'</span><span>'+x.score+'</span></div>'; }).join('')):'';
    $('board').classList.toggle('hidden', !board.length);
    var coinsLine=state.practice?'稽古ではコインは出ません':(s.win?('+'+s.gained+' コイン獲得（勝利+20・揃い'+(s.contrib||0)+'回×5）'):'コインは勝利で獲得できます');
    $('resultCoins').textContent=coinsLine;
    renderReview(m);
    renderPracticeBest(m, b);
    var next=$('resultNextBtn'), sub=$('resultMypageBtn'), note=$('resultCountNote');
    stopResultCountdown();
    resultOutcome=outcome;
    next.disabled=false; note.classList.add('hidden');
    if(outcome==='continue'){
      sub.textContent='マイページへ';
      note.textContent='次は'+C.TOUR_LABEL[Math.min(state.streak,2)]+'。時間内に押すと続けて対戦します';
      note.classList.remove('hidden');
      /* 結果を出す前に控室へ戻った知らせが届いていたら（continueUntil が 0）、最初から控室への案内にする */
      if(!state.continueUntil) resultBackToLobby();
      else { updateResultCountdown(); resultCountTimer=setInterval(updateResultCountdown, 500); }
    }
    else if(outcome==='practice'){ next.textContent='もう一度稽古する'; sub.textContent='タイトルへ'; }
    else { next.textContent='この連でもう一度'; sub.textContent='マイページへ'; }
    next.onclick=function(){
      A.select(); stopResultCountdown();
      if(resultOutcome==='continue'){ sendContinue(); }
      else if(resultOutcome==='lobby'){ showScreen('screen-lobby'); }
      else if(resultOutcome==='practice'){ startPractice(); }
      else { state.needAd=true; NET.send({ t:'ready' }); showScreen('screen-lobby'); }
    };
    sub.onclick=function(){ tick(); stopResultCountdown(); if(resultOutcome==='practice'){ leavePractice(); enterTitle(); } else showMyPage(); };
    STAGE.stop();
    showScreen('screen-result');
  }
  /* ---- 勝利後の「次の対戦へ」: 残り秒数を出す。時間切れでサーバーが控室へ戻したら、控室で続きができる ---- */
  var resultCountTimer=null, resultOutcome=null;
  function continueLeft(){ return state.continueUntil?Math.max(0, state.continueUntil-performance.now()):0; }
  function stopResultCountdown(){ if(resultCountTimer){ clearInterval(resultCountTimer); resultCountTimer=null; } }
  function updateResultCountdown(){
    var next=$('resultNextBtn'), left=Math.ceil(continueLeft()/1000);
    if(left>0){ next.textContent='次の対戦へ（あと'+left+'秒）'; return; }
    stopResultCountdown();
    /* 時間切れの後に押すと、サーバーはもう控室に戻していて「次の相手を探す」画面から抜けられなくなる。
     * 控室に戻った知らせ（lobby）が届くまで押せなくする */
    next.textContent='次の対戦へ（時間切れ）'; next.disabled=true;
    var note=$('resultCountNote'); note.textContent='時間切れです。控室に戻っています…'; note.classList.remove('hidden');
  }
  function resultBackToLobby(){
    if(resultOutcome!=='continue') return;
    stopResultCountdown();
    resultOutcome='lobby';
    $('resultNextBtn').disabled=false;
    $('resultNextBtn').textContent='控室へ（勝ち進みはそのまま）';
    var note=$('resultCountNote'); note.textContent='控室で「準備完了」を押すと、続きの対戦を探します'; note.classList.remove('hidden');
  }
  function sendContinue(){
    state.continueUntil=0;
    NET.send({ t:'continueTour' });
    showScreen('screen-match');
    hud.searching.classList.remove('hidden'); $('searchingText').textContent='次の相手を探しています…';
  }
  /* ---- 自分の拍の振り返り（極=◎ 良=● 可=◆ 惜=▲ 空=×。上が早い・下が遅い） ---- */
  var GRADE_MARK={ KIWAMI:'dbl', YOI:'dot', KA:'dia', OSHII:'tri' };
  function markSvg(kind, x, y, color){
    if(kind==='dbl') return '<circle cx="'+x+'" cy="'+y+'" r="6.5" fill="none" stroke="'+color+'" stroke-width="2"/><circle cx="'+x+'" cy="'+y+'" r="3" fill="'+color+'"/>';
    if(kind==='dot') return '<circle cx="'+x+'" cy="'+y+'" r="5.5" fill="'+color+'"/>';
    if(kind==='dia') return '<path d="M'+x+' '+(y-6.5)+'L'+(x+6.5)+' '+y+'L'+x+' '+(y+6.5)+'L'+(x-6.5)+' '+y+'Z" fill="'+color+'"/>';
    if(kind==='tri') return '<path d="M'+x+' '+(y-6.5)+'L'+(x+6.5)+' '+(y+5)+'L'+(x-6.5)+' '+(y+5)+'Z" fill="'+color+'"/>';
    return '<path d="M'+(x-4.5)+' '+(y-4.5)+'L'+(x+4.5)+' '+(y+4.5)+'M'+(x+4.5)+' '+(y-4.5)+'L'+(x-4.5)+' '+(y+4.5)+'" stroke="'+color+'" stroke-width="2.2" stroke-linecap="round"/>';
  }
  function legendIcon(kind, color){ return '<svg viewBox="-8 -8 16 16" aria-hidden="true">'+markSvg(kind, 0, 0, color)+'</svg>'; }
  function renderReview(m){
    var box=$('review'), rounds=m.rounds.filter(function(r){ return r.marks; });
    if(!rounds.length){ box.classList.add('hidden'); box.innerHTML=''; return; }
    var cols=rounds[0].marks.length, W=300, labelW=38, colW=(W-labelW-4)/cols, headH=20, rowH=48, H=headH+rounds.length*rowH;
    var counts={ KIWAMI:0, YOI:0, KA:0, OSHII:0, MISS:0 }, sum=0, n=0, total=0;
    var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-labelledby="reviewSum">';
    for(var c=0;c<cols;c++){
      var hx=labelW+colW*(c+0.5), last=(c===cols-1);
      svg+='<text x="'+hx.toFixed(1)+'" y="15" text-anchor="middle" font-size="15" fill="'+(last?'#f9e6a0':'#b7b5d2')+'" font-weight="'+(last?'800':'400')+'">'+(last?'！':(c+1))+'</text>';
    }
    rounds.forEach(function(r, ri){
      var top=headH+ri*rowH, cy=top+rowH/2, amp=rowH/2-8;
      svg+='<text x="0" y="'+(cy+5)+'" font-size="15" fill="#f7f0de">'+(C.ROUND_LABEL[r.r-1]||'')+'</text>';
      svg+='<line x1="'+labelW+'" y1="'+cy+'" x2="'+(W-4)+'" y2="'+cy+'" stroke="rgba(224,182,84,.34)" stroke-width="1"/>';
      if(ri>0) svg+='<line x1="0" y1="'+top+'" x2="'+W+'" y2="'+top+'" stroke="rgba(224,182,84,.16)" stroke-width="1"/>';
      r.marks.forEach(function(mk, c){
        var x=labelW+colW*(c+0.5); total++;
        if(!mk){ counts.MISS++; svg+=markSvg('miss', x.toFixed(1), cy, '#8e8aa8'); return; }
        var g=C.gradeByKey(mk.g)||C.GRADES[C.GRADES.length-1], d=U.clamp(mk.d,-C.HIT_WINDOW_MS,C.HIT_WINDOW_MS);
        var y=cy+d/C.HIT_WINDOW_MS*amp;
        counts[g.key]=(counts[g.key]||0)+1; sum+=mk.d; n++;
        svg+='<line x1="'+x.toFixed(1)+'" y1="'+cy+'" x2="'+x.toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="'+g.color+'" stroke-width="2" opacity=".7"/>';
        svg+=markSvg(GRADE_MARK[g.key]||'dot', x.toFixed(1), +y.toFixed(1), g.color);
      });
    });
    svg+='</svg>';
    var avg=n?Math.round(sum/n):0;
    var tendency=!n?'叩けた拍がありません':(Math.abs(avg)<=20?'ぴったり':(avg>0?'遅れ気味':'早め'));
    var sumText=total+'打中 '+n+'打。極'+counts.KIWAMI+'・良'+counts.YOI+'・可'+counts.KA+'・惜'+counts.OSHII+'・空'+counts.MISS+'。平均のずれ '+(avg>0?'+':'')+avg+'ms（'+tendency+'）';
    var G=C.GRADES;
    var html='<div class="review-head"><b>あなたの拍</b><span>平均 '+(avg>0?'+':'')+avg+'ms・'+tendency+'</span></div>'+svg+
      '<p id="reviewSum" class="sr-only">'+U.escapeHtml(sumText)+'</p>'+
      '<div class="review-legend" aria-hidden="true">'+
        '<span>'+legendIcon('dbl',G[0].color)+'極 '+counts.KIWAMI+'</span><span>'+legendIcon('dot',G[1].color)+'良 '+counts.YOI+'</span>'+
        '<span>'+legendIcon('dia',G[2].color)+'可 '+counts.KA+'</span><span>'+legendIcon('tri',G[3].color)+'惜 '+counts.OSHII+'</span>'+
        '<span>'+legendIcon('miss','#8e8aa8')+'空 '+counts.MISS+'</span></div>'+
      '<div class="review-legend" aria-hidden="true"><span>線より上は早い・下は遅い</span></div>';
    if(n>=4 && Math.abs(avg)>=40){
      html+='<p class="review-tip">'+(avg>0?'いつも遅れ気味です。':'いつも早めです。')+'太鼓が遅れて聞こえる端末では、設定の「音のタイミング」で合わせられます</p>'+
        '<div class="text-link-row"><button type="button" class="btn-text" id="reviewSettingsBtn">音のタイミングを調整する</button></div>';
    }
    box.innerHTML=html; box.classList.remove('hidden');
    var rb=$('reviewSettingsBtn'); if(rb) rb.addEventListener('click', function(){ tick(); openSettings(); });
  }
  /* ---- 稽古の自己ベスト（3番の合計点） ---- */
  function renderPracticeBest(m, b){
    var el=$('resultBest'); el.innerHTML=''; el.classList.add('hidden');
    if(!state.practice) return;
    var total=Math.round(b.yourPower||m.youPower||0), best=+(lsGet('mikoshiPracticeBest')||0)||0;
    if(total>best){
      lsSet('mikoshiPracticeBest', String(total));
      el.innerHTML='<span class="best-badge">自己ベスト更新！ '+total+'点'+(best?'（これまで '+best+'点）':'')+'</span>';
    } else el.innerHTML='<span class="best-badge plain">今回 '+total+'点・自己ベスト '+best+'点</span>';
    el.classList.remove('hidden');
  }

  /* ================= マイページ・ガチャ・着せ替え ================= */
  function swatchHtml(item, big){
    var col=item.color!==undefined?U.hex(item.color):({ N:'#4a4f78', R:'#2a6a9a', SR:'#6a3fa0', SSR:'#c8962a' })[item.rarity];
    var ch={ happi:'法', band:'巻', obi:'帯', hand:item.kind==='fan'?'扇':'灯', aura:'気', haori:'羽', head:item.kind==='kitsune'?'狐':'鯱' }[item.slot]||'祭';
    return '<span class="item-swatch'+(big?' big':'')+'" style="background:'+col+'">'+ch+'</span>';
  }
  function showMyPage(){
    STAGE.stop();
    showScreen('screen-mypage');
    $('mypageName').textContent=(state.name||'ゲスト')+' さん';
    $('mypageCoins').textContent=state.coins;
    $('mypageCostumes').textContent=state.owned.length;
    $('mypageWins').textContent=state.wins;
    updateMypageRetry();
  }
  /* マイページの主ボタン: 勝ち進みの受付中なら「次の対戦へ」、連にいれば控室、どこにもいなければ連選び */
  function updateMypageRetry(){
    var b=$('mypageRetryBtn');
    if(state.pid && continueLeft()>0) b.textContent='次の対戦へ（'+C.TOUR_LABEL[Math.min(state.streak,2)]+'）';
    else if(state.pid && state.roomId) b.textContent=state.streak>0?'控室へ戻る（次は'+C.TOUR_LABEL[Math.min(state.streak,2)]+'）':'控室へ戻る';
    else b.textContent='連を選んで参加する';
  }
  $('mypageGachaBtn').addEventListener('click', function(){ tick(); showGacha(); });
  $('mypageAvatarBtn').addEventListener('click', function(){ tick(); showEquip(); });
  $('mypageRetryBtn').addEventListener('click', function(){
    tick();
    if(!state.pid){ showScreen('screen-login'); return; }
    if(continueLeft()>0){ A.select(); sendContinue(); return; }
    if(state.roomId){ showScreen('screen-lobby'); return; }
    NET.send({ t:'listTeams' }); showScreen('screen-teamselect');
  });
  $('mypageTitleBtn').addEventListener('click', function(){ tick(); enterTitle(); });
  function showGacha(){
    STAGE.stop();
    showScreen('screen-gacha');
    state.gachaBusy=false;
    $('gachaMedalBadge').textContent='所持コイン: '+state.coins+'枚';
    $('gachaResultCard').classList.add('hidden'); $('gachaToEquipBtn').classList.add('hidden');
    $('gachaCapsule').className='gacha-capsule'; $('gachaGlow').className='gacha-glow';
    var btn=$('gachaDrawBtn'); btn.classList.remove('hidden');
    var poor=state.coins<C.GACHA_COST;
    btn.disabled=poor;
    btn.textContent=C.GACHA_COST+'コインで衣装ガチャを引く';
    var note=$('gachaNote'); note.classList.toggle('hidden', !poor);
    note.textContent=poor?('コインが足りません。あと'+(C.GACHA_COST-state.coins)+'枚（対戦に勝つと+20枚）'):'';
  }
  $('gachaDrawBtn').addEventListener('click', function(){
    if(state.coins<C.GACHA_COST || state.gachaBusy) return;
    state.gachaBusy=true;
    $('gachaDrawBtn').classList.add('hidden'); $('gachaNote').classList.add('hidden');
    $('gachaCapsule').classList.add('shaking');
    NET.send({ t:'gacha' });
  });
  function onGachaResult(msg){
    state.coins=msg.coins; state.owned.push(msg.key);
    var item=C.catalogByKey(msg.key)||C.CATALOG[0];
    if(msg.rarity==='SSR'||msg.rarity==='SR') A.sparkle(); else A.tick();
    $('gachaMedalBadge').textContent='所持コイン: '+state.coins+'枚';
    setTimeout(function(){
      $('gachaCapsule').classList.remove('shaking'); $('gachaCapsule').classList.add('cracked');
      $('gachaGlow').className='gacha-glow show rarity-'+msg.rarity.toLowerCase();
      setTimeout(function(){
        $('gachaAvatarIcon').innerHTML=swatchHtml(item, true);
        $('gachaAvatarName').textContent=item.name;
        var rb=$('gachaAvatarRarity'); rb.textContent=msg.rarity; rb.className='gacha-rarity-badge rarity-'+msg.rarity.toLowerCase();
        $('gachaResultCard').classList.remove('hidden'); $('gachaToEquipBtn').classList.remove('hidden');
        state.gachaBusy=false;
      }, 450);
    }, 900);
  }
  $('gachaToEquipBtn').addEventListener('click', function(){ tick(); showEquip(); });
  $('gachaBackBtn').addEventListener('click', function(){ tick(); showMyPage(); });
  function equippedItems(){ return Object.keys(state.equipped).map(C.catalogByKey).filter(Boolean); }
  function showEquip(){
    showScreen('screen-equip');
    $('equipStageLabel').textContent=state.owned.length?'衣装を選んで着替えよう':'衣装ガチャで衣装を手に入れよう';
    if(STAGE.ready || STAGE.init($('threeCanvas'))) STAGE.showViewer({ teamName:state.teamName||state.name||'祭', items:equippedItems() });
    renderEquipList();
  }
  function renderEquipList(){
    var list=$('equipList'); list.innerHTML='';
    var seen={};
    state.owned.forEach(function(k, idx){
      if(seen[k]) return; seen[k]=true;
      var item=C.catalogByKey(k); if(!item) return;
      var eq=!!state.equipped[k];
      var row=document.createElement('div');
      row.className='equip-row'+(idx===state.owned.length-1?' is-new':'');
      row.innerHTML=swatchHtml(item)+'<span class="equip-name">'+U.escapeHtml(item.name)+' <span class="rar">('+item.rarity+')</span></span>'+
        '<button type="button" class="btn-primary equip-btn'+(eq?' is-equipped':'')+'"'+(eq?' disabled':'')+' aria-label="'+U.escapeHtml(item.name)+(eq?'（装備中）':'を装備する')+'">'+(eq?'装備中':'装備する')+'</button>';
      row.querySelector('button').addEventListener('click', function(){
        if(state.equipped[k]) return;
        A.select();
        /* 同じ部位の装備は付け替え（見た目のみ。サーバーには装備を追加で伝える） */
        Object.keys(state.equipped).forEach(function(ek){ var e=C.catalogByKey(ek); if(e && e.slot===item.slot) delete state.equipped[ek]; });
        state.equipped[k]=true;
        NET.send({ t:'equip', key:k });
        if(STAGE.mode==='viewer') STAGE.showViewer({ teamName:state.teamName||state.name||'祭', items:equippedItems() });
        renderEquipList();
      });
      list.appendChild(row);
    });
  }
  $('equipMoreGachaBtn').addEventListener('click', function(){ tick(); showGacha(); });
  $('equipBackBtn').addEventListener('click', function(){ tick(); showMyPage(); });

  /* ================= 稽古モード（画面の中だけで完結する練習相手） ================= */
  function Practice(){
    var self=this, timers=[], plan=null, sides=null;
    this.serverNow=function(){ return Date.now(); };
    function emit(type, msg){ msg.t=type; setTimeout(function(){ if(H[type]) H[type](msg); }, 0); }
    function later(ms, fn){ timers.push(setTimeout(fn, ms)); }
    this.stop=function(){ timers.forEach(clearTimeout); timers=[]; };
    this.start=function(){
      var me={ pid:PRACTICE_ID, name:state.name||'あなた', equipped:Object.keys(state.equipped) };
      sides=[ { id:'A', name:'稽古連', size:8, humans:1, power:0, clash:0, combo:0, rounds:[] },
              { id:'B', name:'指南役', size:8, humans:0, power:0, clash:0, combo:0, rounds:[] } ];
      self.me=me.pid;
      emit('matched', { you:{ name:'稽古連', size:8, humans:1, variant:state.customVariant||'classic', level:1, members:[me] },
        enemy:{ name:'指南役', size:8, humans:0, variant:'kuro', level:1, members:[] }, tour:0 });
    };
    this.send=function(msg){
      if(msg.t==='arena') later(900, function(){ round(1); });
      else if(msg.t==='tap') tap(msg);
    };
    function round(r){
      var beatMs=Math.round(60000/C.TEMPO_BPM[r-1]), now=Date.now();
      var startAt=now+1400+C.COUNT_IN*beatMs, clashIdx=C.BEATS+2;
      plan={ r:r, beatMs:beatMs, startAt:startAt, clashIdx:clashIdx, mine:new Array(C.BEATS+1), done:0, clashDone:false, helper:{},
        bots:{ A:SC.botTeamPlan(7, 'mid', C.BEATS), B:SC.botTeamPlan(8, r===3?'mid':'low', C.BEATS) } };
      emit('round', { r:r, beatMs:beatMs, beats:C.BEATS, countIn:C.COUNT_IN, startAt:startAt, clashAt:startAt+clashIdx*beatMs,
        hitWindow:C.HIT_WINDOW_MS, teamSize:8, enemySize:8, botTaps:plan.bots.A, enemyTaps:plan.bots.B });
      for(var i=0;i<C.BEATS;i++) (function(i){ later(startAt+i*beatMs+C.HIT_WINDOW_MS+60-now, function(){ closeBeat(i); }); })(i);
      later(startAt+clashIdx*beatMs+C.HIT_WINDOW_MS+60-now, closeClash);
    }
    function tap(msg){
      if(!plan || plan.clashDone || msg.r!==plan.r) return;
      var rel=msg.at-plan.startAt, idx=Math.round(rel/plan.beatMs), slot;
      if(idx>=0 && idx<C.BEATS) slot=idx; else if(idx===plan.clashIdx) slot=C.BEATS; else return;
      if(slot<C.BEATS && slot<plan.done) return;
      var d=rel-idx*plan.beatMs; if(Math.abs(d)>C.HIT_WINDOW_MS || plan.mine[slot]!==undefined) return;
      plan.mine[slot]=Math.round(d);
    }
    /* 稽古連の助っ人（サーバーと同じ規則）: 自分が叩いた拍は自分のズレ d に寄せる d_h=round(d*0.8+N(0,22))・叩き損ね3%。
     * 自分が叩かなかった拍は予定＋N(0,60)・叩き損ね35%。拍ごとに一度だけ決める */
    function helperTaps(i){
      if(plan.helper[i]) return plan.helper[i];
      var mine=plan.mine[i], out=[];
      plan.bots.A.forEach(function(a,k){
        var d;
        if(mine!==undefined){ if(Math.random()<0.03) return; d=Math.round(mine*0.8+U.randomNormal(0,22)); }
        else { if(a[i]===null || a[i]===undefined || Math.random()<0.35) return; d=Math.round(a[i]+U.randomNormal(0,60)); }
        if(Math.abs(d)<=C.HIT_WINDOW_MS) out.push({ id:'b'+k, d:d });
      });
      return (plan.helper[i]=out);
    }
    function taps(side, i){
      var out=[];
      if(side.id==='A'){
        if(plan.mine[i]!==undefined) out.push({ id:self.me, d:plan.mine[i] });
        return out.concat(helperTaps(i));
      }
      plan.bots.B.forEach(function(a,k){ if(a[i]!==null && a[i]!==undefined) out.push({ id:'b'+k, d:a[i] }); });
      return out;
    }
    function closeBeat(i){
      var res={};
      sides.forEach(function(s){ var sc=SC.beat(taps(s,i), 8, s.combo); s.combo=sc.combo; s.power+=sc.pts; res[s.id]=sc; });
      plan.done=i+1;
      var d=plan.mine[i], g=d!==undefined?SC.gradeOf(d):null;
      emit('beat', { r:plan.r, i:i, you:{ pts:res.A.pts, sync:res.A.sync, combo:res.A.combo, power:sides[0].power },
        enemy:{ pts:res.B.pts, sync:res.B.sync, combo:res.B.combo, power:sides[1].power },
        me:d!==undefined?{ d:d, g:g?g.key:'OSHII', synced:res.A.synced.indexOf(self.me)>=0 }:null });
    }
    function closeClash(){
      plan.clashDone=true;
      var res={};
      sides.forEach(function(s){ var c=SC.clash(taps(s,C.BEATS), 8, s.combo); s.power+=c.pts; s.clash+=c.pts; res[s.id]=c; s.rounds.push({ clash:c.pts, judgement:c.judgement }); });
      var hits=0, goods=0;
      for(var i=0;i<C.BEATS;i++){ if(plan.mine[i]!==undefined){ hits++; var g=SC.gradeOf(plan.mine[i]); if(g && g.w>=0.7) goods++; } }
      var a=res.A, b=res.B, A1=sides[0], B1=sides[1];
      emit('roundResult', { r:plan.r, best:a.best, validCount:taps(A1,C.BEATS).length, teamSize:8, pct:a.pct, judgement:a.judgement, synced:a.synced,
        clashPts:Math.round(a.pts*10)/10, power:A1.power, combo:A1.combo, enemyPower:B1.power, enemyJudgement:b.judgement, enemyPct:b.pct,
        enemyClashPts:Math.round(b.pts*10)/10,
        me:{ hits:hits, goods:goods, beats:C.BEATS, clashD:plan.mine[C.BEATS]!==undefined?plan.mine[C.BEATS]:null, clashSynced:a.synced.indexOf(self.me)>=0 } });
      if(plan.r<C.ROUNDS) later(2600, function(){ round(plan.r+1); });
      else later(2600, function(){
        var win=A1.power>B1.power || (A1.power===B1.power && A1.clash>=B1.clash);
        emit('battle', { win:win, yourPower:A1.power, enemyPower:B1.power, rounds:A1.rounds, enemyRounds:B1.rounds, board:[], mvp:null });
        later(4400, function(){ emit('settle', { win:win, gained:0, coins:state.coins, level:0, streak:0, outcome:'practice' }); });
      });
    }
  }
  var practice=null;
  function leavePractice(){
    if(practice) practice.stop(); practice=null; state.practice=false; TX=NET; clearMatchTimers(state.match); state.match=null;
    /* 途中でやめたとき、予約済みの太鼓・掛け声がタイトル画面で鳴り続けないよう止める */
    if(A.cancelScheduled) A.cancelScheduled();
    lastAudioKey=null;
  }
  function startPractice(){
    if(practice) practice.stop();
    state.practice=true; state.needAd=false;
    practice=new Practice(); TX=practice;
    practice.start();
  }

  /* ================= 受信の配線 ================= */
  H.welcome=function(msg){
    state.pid=msg.pid; state.token=msg.token; state.name=msg.name; state.coins=msg.coins||0; state.wins=msg.wins||0;
    state.owned=(msg.owned||[]).slice(); state.equipped={};
    (msg.equipped||[]).forEach(function(k){ state.equipped[k]=true; });
    try{ localStorage.setItem('mikoshiToken', msg.token); }catch(e){}
    if(state.awaitingWelcome){
      state.awaitingWelcome=false;
      joinBtn.disabled=false; joinBtn.textContent='オンラインで参加';
      A.select();
      if(state.inviteTeamId){ var tid=state.inviteTeamId; state.inviteTeamId=null; showScreen('screen-teamselect'); NET.send({ t:'listTeams' }); NET.send({ t:'joinTeam', id:tid }); }
      else runQrSequence();
    }
  };
  H.err=function(msg){
    toast(msg.msg||'エラーが発生しました');
    if(state.awaitingWelcome){ state.awaitingWelcome=false; joinBtn.disabled=false; joinBtn.textContent='オンラインで参加'; }
    if(msg.code==='coins'){ state.gachaBusy=false; showGacha(); }
    if(msg.code==='auth'){ state.pid=null; STAGE.stop(); showScreen('screen-login'); toast('接続し直します。もう一度参加してください'); }
  };
  H.teams=function(msg){ state.teamList=msg.list||[]; buildTeamSelect(); };
  H.lobby=renderLobby;
  H.searching=function(){
    var btn=$('lobbyReadyBtn'); btn.disabled=true; btn.textContent='対戦相手を探しています…';
    if(activeScreen()==='screen-match'){ hud.searching.classList.remove('hidden'); }
  };
  H.matched=onMatched;
  H.round=onRound;
  H.tapped=onTapped;
  H.beat=onBeat;
  H.roundResult=onRoundResult;
  H.battle=onBattle;
  H.settle=onSettle;
  H.gachaResult=onGachaResult;
  H.coinsUpdate=function(msg){
    state.coins=msg.coins;
    toast('+'+msg.gained+'コインを受け取りました'+(msg.reason?('（'+msg.reason+'）'):''));
    if(activeScreen()==='screen-gacha') showGacha();
    if(activeScreen()==='screen-mypage') showMyPage();
  };
  H.equipped=function(msg){ /* サーバーは付け足し式。見た目の付け替えは画面側の state.equipped を優先 */ };
  /* 通信が切れて繋がり直したら、ログイン済みなら黙って名乗り直す（ログイン画面へ戻さない） */
  NET.on('__open', function(){ if(state.pid && state.token && !state.awaitingWelcome) NET.send({ t:'register', token:state.token }); });
  Object.keys(H).forEach(function(k){
    NET.on(k, function(msg){
      /* 稽古中はオンラインの試合メッセージを無視する */
      if(state.practice && ['round','tapped','beat','roundResult','battle','settle','matched'].indexOf(k)>=0) return;
      H[k](msg);
    });
  });

  /* ================= 起動 ================= */
  try{ state.token=localStorage.getItem('mikoshiToken')||null; }catch(e){}
  try{ state.inviteTeamId=new URLSearchParams(location.search).get('team')||null; }catch(e){}
  initGoogleLogin();
  NET.connect();
  buildTeamSelect();
  enterTitle();
  /* 最初のタップで音を有効にする（ブラウザの決まり） */
  document.addEventListener('pointerdown', function unlock(){ A.init(); A.setCrowd(activeScreen()==='screen-match'?0.8:0.4); document.removeEventListener('pointerdown', unlock); }, { once:true });

  /* テスト用フック */
  window.__mikoshiTest={
    state:state,
    selfTest:function(){ return STAGE.selfTest(); },
    tap:function(){ onTapInput(null); },
    stopPractice:function(){ leavePractice(); enterTitle(); },
    round:function(){ var m=state.match; return m&&m.round; },
    settings:function(){ return { volume:settings.volume, offset:A.offset(), motion:settings.motion, reduceMotion:!!MK.reduceMotion }; },
    match:function(){ return state.match; }
  };
})();
