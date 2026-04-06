/**
 * Puppeteer 在地渲染：以最小 HTML + 內嵌腳本繪製戰報卡，避免 page.goto Hosting 載入整包 Vite SPA。
 * 視覺為 BattleCard 匯出場景之精簡版（640 設計座標 × scale 至 1080），與 React 版非像素級一致。
 */

import { SSR_BATTLE_CARD_STANCE_COLORS } from "./battleCardConstants.js";

const NOISE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8 0.02' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' fill='%23d0d0d0'/%3E%3C/svg%3E";

/** 寫入 `<script>` 內嵌 JSON 時跳脫 `<`，避免誤解析為標籤結尾。 */
function jsonForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function getCriticalCss() {
  return (
    "*{box-sizing:border-box;transition:none!important;animation:none!important}" +
    "html,body{margin:0;padding:0;width:1080px;height:1080px;overflow:hidden;background:#000;color:#fff;" +
    "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif}" +
    "#render-target{width:1080px;height:1080px;position:relative;overflow:hidden;background:#000}" +
    "#render-ready-signal{position:absolute;width:1px;height:1px;left:0;bottom:0;opacity:0;pointer-events:none}"
  );
}

/** 內嵌於頁面：自 window.__DATA__ 建 DOM 並寫入 #render-ready-signal */
function buildClientRuntimeIife() {
  return `;(function(){
var STANCE_COLORS=${JSON.stringify(SSR_BATTLE_CARD_STANCE_COLORS)};
var NOISE_DATA_URL=${JSON.stringify(NOISE_DATA_URL)};
function stanceColor(key){
  var k=String(key||'goat').toLowerCase();
  return STANCE_COLORS[k]||STANCE_COLORS.goat;
}
function getPowerStanceModel(stanceDisplayName){
  var normalized=String(stanceDisplayName||'GOAT').toUpperCase().trim()||'GOAT';
  var len=normalized.length;
  if(len>=11){
    var idx=normalized.indexOf(' ');
    var line1=idx>0?normalized.slice(0,idx):normalized;
    var line2=idx>0?normalized.slice(idx+1):'';
    return{line1:line1,line2:line2,isMultiLine:true,fontSize:90,lineHeight:0.85};
  }
  var isMedium=len>=8&&len<=10;
  return{line1:normalized,line2:'',isMultiLine:false,fontSize:isMedium?95:120,lineHeight:1};
}
function withAlpha(hex,aa){
  var h=String(hex||'#000').replace('#','');
  if(h.length!==6)return hex;
  return '#'+h+String(aa||'FF');
}
function el(tag,props,children){
  var n=document.createElement(tag);
  if(props&&props.style)for(var k in props.style)if(Object.prototype.hasOwnProperty.call(props.style,k))n.style[k]=props.style[k];
  if(children)for(var i=0;i<children.length;i++){
    var c=children[i];
    if(c==null)continue;
    if(typeof c==='string')n.appendChild(document.createTextNode(c));
    else n.appendChild(c);
  }
  return n;
}
function markReady(){
  if(!document.getElementById('render-ready-signal')){
    var s=document.createElement('div');
    s.id='render-ready-signal';
    document.body.appendChild(s);
  }
}
function run(){
  var D=window.__DATA__;
  if(!D){markReady();return;}
  var target=document.getElementById('render-target');
  if(!target)return;
  var primary=D.theme&&D.theme.primaryColor||'#C8102E';
  var secondary=D.theme&&D.theme.secondaryColor||'#2E003E';
  var stanceKey=String(D.status||'goat').toLowerCase();
  var stanceC=stanceColor(stanceKey);
  var stanceTitle=String(D.stanceDisplayPrimary||stanceKey||'GOAT').toUpperCase();
  var pm=getPowerStanceModel(stanceTitle);
  var reasons=Array.isArray(D.reasonLabels)?D.reasonLabels:[];
  var displayName=String(D.displayName||'Warrior');
  var teamLabel=String(D.teamLabel||'').toUpperCase()||'—';
  var battleTitle=String(D.battleTitle||'');
  var battleSubtitle=String(D.battleSubtitle||'');
  var rankLabel=String(D.rankLabel||'');

  var stage=el('div',{style:{
    width:'1080px',height:'1080px',position:'relative',overflow:'hidden',background:'#000'
  }},[]);

  var scaleWrap=el('div',{style:{
    width:'640px',height:'640px',transform:'scale(1.6875)',transformOrigin:'top left',position:'relative'
  }},[]);

  var bgGrad='linear-gradient(115deg,'+withAlpha(primary,'FF')+' 0%,'+withAlpha(primary,'E6')+' 45%,rgba(0,0,0,0.82) 50%,'+withAlpha(secondary,'E6')+' 55%,'+withAlpha(secondary,'FF')+' 100%)';
  var card=el('div',{style:{
    position:'relative',width:'640px',height:'640px',borderRadius:'16px',overflow:'hidden',
    display:'flex',flexDirection:'column',minHeight:0,
    backgroundImage:bgGrad+',repeating-linear-gradient(115deg,'+withAlpha('#888888','18')+' 0px,'+withAlpha('#888888','18')+' 1px,transparent 1px,transparent 10px)',
    backgroundSize:'100% 100%, 100% 100%',
    border:'2px solid '+withAlpha(secondary,'AA'),
    filter:'saturate(1.45) contrast(1.15) brightness(1.05)',
    boxShadow:'inset 0 0 80px rgba(0,0,0,0.88), 0 0 18px '+withAlpha(secondary,'44')
  }},[]);

  var noise=el('div',{style:{
    position:'absolute',inset:'0',pointerEvents:'none',borderRadius:'16px',opacity:0.06,
    backgroundImage:'url('+NOISE_DATA_URL+')',backgroundRepeat:'repeat',zIndex:2
  }},[]);
  var wash=el('div',{style:{
    position:'absolute',inset:'0',pointerEvents:'none',borderRadius:'16px',zIndex:3,
    background: primary==secondary?primary:('linear-gradient(90deg,'+primary+','+secondary+')'),
    opacity:0.14,mixBlendMode:'normal'
  }},[]);
  var grid=el('div',{style:{
    position:'absolute',inset:'0',pointerEvents:'none',borderRadius:'16px',zIndex:4,opacity:0.85,
    backgroundImage:'repeating-linear-gradient(0deg,rgba(255,255,255,0.02) 0px 1px,transparent 1px 20px),repeating-linear-gradient(90deg,rgba(255,255,255,0.02) 0px 1px,transparent 1px 20px)'
  }},[]);

  var wall=el('div',{style:{
    position:'absolute',inset:'0',zIndex:1,pointerEvents:'none',transform:'rotate(-15deg)',
    opacity:0.35,overflow:'hidden',
    display:'flex',flexWrap:'wrap',gap:'8px 16px',padding:'16px',alignContent:'flex-start',
    mixBlendMode:'exclusion'
  }},[]);
  for(var w=0;w<24;w++){
    wall.appendChild(el('span',{style:{
      fontSize:(28+((w*7)%40))+'px',fontWeight:(w%2?'900':'200'),fontStyle:'italic',textTransform:'uppercase',color:'#c8c8c8',
      whiteSpace:'nowrap',lineHeight:1
    }},[teamLabel]));
  }

  var hdr=el('div',{style:{position:'relative',zIndex:10,textAlign:'center',padding:'20px 20px 0',flexShrink:0}},[
    el('h2',{style:{
      margin:'0 0 4px',fontSize:'12px',letterSpacing:'0.2em',textTransform:'uppercase',fontWeight:600,color:withAlpha(stanceC,'CC'),
      textShadow:'0 1px 2px rgba(0,0,0,0.65)'
    }},[battleSubtitle]),
    el('h1',{style:{
      margin:0,fontSize:'34px',fontWeight:900,fontStyle:'italic',letterSpacing:'-0.03em',color:stanceC,
      textTransform:'uppercase',whiteSpace:'nowrap',
      textShadow:'0 1px 2px rgba(0,0,0,0.65), 0 0 16px '+withAlpha(stanceC,'44')
    }},[battleTitle])
  ]);

  var idRow=el('div',{style:{position:'relative',zIndex:10,margin:'12px 20px',borderRadius:'12px',padding:'8px',display:'flex',gap:'12px',alignItems:'center'}},[]);
  var idBg=el('div',{style:{position:'absolute',inset:'0',borderRadius:'12px',background:'rgba(0,0,0,0.45)',zIndex:0}},[]);
  idRow.appendChild(idBg);
  var avWrap=el('div',{style:{
    position:'relative',zIndex:1,width:'48px',height:'48px',borderRadius:'50%',overflow:'hidden',border:'2px solid rgba(255,255,255,0.2)',background:'rgba(255,255,255,0.08)',flexShrink:0
  }},[]);
  if(D.avatarUrl){
    var img=new Image();
    img.crossOrigin='anonymous';
    img.referrerPolicy='no-referrer';
    img.alt='';
    img.style.width='100%';
    img.style.height='100%';
    img.style.objectFit='cover';
    img.src=D.avatarUrl;
    avWrap.appendChild(img);
  }else{
    avWrap.appendChild(el('div',{style:{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',color:'rgba(255,255,255,0.55)'}},['?']));
  }
  var idText=el('div',{style:{position:'relative',zIndex:1,minWidth:0,flex:1}},[
    el('p',{style:{margin:0,fontSize:'13px',fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',color:'#fff',textShadow:'0 1px 2px rgba(0,0,0,0.65)'}},[displayName]),
    el('p',{style:{margin:'4px 0 0',fontSize:'13px',fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',color:primary,textShadow:'0 1px 2px rgba(0,0,0,0.65)'}},[teamLabel])
  ]);
  idRow.appendChild(avWrap);
  idRow.appendChild(idText);

  var stanceBox=el('div',{style:{
    position:'relative',zIndex:10,margin:'12px 40px',padding:'20px 24px',borderRadius:'16px',textAlign:'center'
  }},[]);
  stanceBox.appendChild(el('div',{style:{
    position:'absolute',inset:'0',margin:'0 -16px',borderRadius:'16px',background:'rgba(0,0,0,0.75)',zIndex:-1,
    boxShadow:'0 0 40px rgba(0,0,0,0.45)'
  }},[]));
  var stanceInner=el('div',{style:{
    position:'relative',fontWeight:900,fontStyle:'italic',textTransform:'uppercase',letterSpacing:'-0.04em',color:stanceC,
    fontSize:pm.fontSize+'px',lineHeight:String(pm.lineHeight),textShadow:'0 0 24px '+withAlpha(stanceC,'AA')+', 0 2px 3px #000',
    filter:'drop-shadow(0 0 10px '+withAlpha(primary,'70')+')'
  }},[]);
  if(pm.isMultiLine){
    stanceInner.appendChild(document.createTextNode(pm.line1));
    stanceInner.appendChild(document.createElement('br'));
    stanceInner.appendChild(document.createTextNode(pm.line2||''));
  }else{
    stanceInner.appendChild(document.createTextNode(pm.line1));
  }
  stanceBox.appendChild(stanceInner);

  var content=el('div',{style:{
    position:'relative',zIndex:10,height:'100%',display:'flex',flexDirection:'column',minHeight:0
  }},[]);
  content.appendChild(hdr);
  content.appendChild(idRow);
  content.appendChild(stanceBox);

  if(reasons.length){
    var ev=el('div',{style:{
      margin:'10px 20px 0',padding:'12px',borderRadius:'8px',background:'rgba(0,0,0,0.7)',border:'1px solid rgba(255,255,255,0.1)',maxHeight:'120px',overflowY:'auto'
    }},[
      el('p',{style:{margin:'0 0 6px',fontSize:'9px',letterSpacing:'0.2em',textTransform:'uppercase',color:'rgba(255,255,255,0.5)'}},['VERDICT / 證詞'])
    ]);
    var rb=[];
    for(var r=0;r<reasons.length;r++){
      if(r)rb.push(document.createTextNode(' / '));
      var sp=el('span',{style:{color:stanceC,fontSize:'13px',fontWeight:600,textShadow:'0 1px 2px rgba(0,0,0,0.65)'}},[String(reasons[r])]);
      rb.push(sp);
    }
    ev.appendChild(el('p',{style:{margin:0,lineHeight:1.35}},rb));
    content.appendChild(ev);
  }

  var foot=el('div',{style:{
    marginTop:'auto',padding:'16px 24px 12px',display:'flex',flexWrap:'wrap',justifyContent:'space-between',alignItems:'flex-end',gap:'8px',
    borderTop:'1px solid rgba(255,255,255,0.12)'
  }},[
    el('div',{style:{minWidth:0}},[
      el('span',{style:{display:'block',fontSize:'11px',color:primary,filter:'brightness(1.1)',textShadow:'0 1px 2px rgba(0,0,0,0.65)'}},['GLOBAL']),
      el('span',{style:{display:'block',marginTop:'2px',fontSize:'11px',color:'rgba(255,255,255,0.88)',textShadow:'0 1px 2px rgba(0,0,0,0.65)'}},[rankLabel])
    ]),
    el('div',{style:{display:'flex',alignItems:'flex-end',gap:'8px',flexShrink:0}},[
      el('span',{style:{fontSize:'38px',lineHeight:1,filter:'drop-shadow(0 0 6px rgba(168,85,247,0.5))'}},['\u265B']),
      el('span',{style:{
        fontSize:'11px',fontWeight:700,letterSpacing:'0.2em',textTransform:'uppercase',color:'#D4AF37',whiteSpace:'nowrap',textShadow:'0 1px 2px rgba(0,0,0,0.65)'
      }},['The GOAT Meter'])
    ])
  ]);
  content.appendChild(foot);
  content.appendChild(el('p',{style:{
    margin:'6px 12px 4px',fontSize:'6px',textAlign:'center',letterSpacing:'0.18em',textTransform:'uppercase',color:'rgba(255,255,255,0.38)'
  }},['VERIFIED DATA · GOAT METER']));
  content.appendChild(el('p',{style:{
    margin:'0 12px 10px',fontSize:'8px',textAlign:'center',lineHeight:1.3,color:'rgba(255,255,255,0.4)'
  }},['Fan sentiment stats. Not affiliated with any player or league.']));

  card.appendChild(wall);
  card.appendChild(noise);
  card.appendChild(wash);
  card.appendChild(grid);
  card.appendChild(content);

  scaleWrap.appendChild(card);
  stage.appendChild(scaleWrap);
  target.appendChild(stage);

  function raf2(fn){requestAnimationFrame(function(){requestAnimationFrame(fn);});}
  var imgs=[].slice.call(document.images||[]);
  var incomplete=imgs.filter(function(i){return !i.complete;});
  if(!incomplete.length){raf2(markReady);return;}
  var left=incomplete.length;
  incomplete.forEach(function(i){
    function ok(){left--;if(left<=0)raf2(markReady);}
    i.addEventListener('load',ok,{once:true});
    i.addEventListener('error',ok,{once:true});
  });
}
run();
})();`;
}

/**
 * @param {object} validatedPayload — 與 generateBattleCard 既有結構一致；可含 stanceDisplayPrimary（與戰報稱號大寫標籤對齊）。
 */
export function buildBattleCardMinimalHtmlDocument(validatedPayload) {
  const dataJson = jsonForInlineScript(validatedPayload);
  const css = getCriticalCss();
  const runtime = buildClientRuntimeIife();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${css}</style></head>
<body style="margin:0;padding:0">
<div id="render-target"></div>
<script>window.__DATA__=${dataJson};</script>
<script>${runtime}</script>
</body></html>`;
}
