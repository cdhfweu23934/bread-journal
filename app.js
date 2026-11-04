(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const icons = name => `<svg class="icon"><use href="#i-${name}"/></svg>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
  const price = value => value === null ? '—' : '$' + new Intl.NumberFormat('en-US', {notation:value >= 1000 ? 'compact' : 'standard',maximumFractionDigits:value >= 1000 ? 2 : 0}).format(value);
  const percent = value => value === null ? '—' : new Intl.NumberFormat('en-US', {minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'always'}).format(Object.is(value,-0)?0:value).replace('-', '−') + '%';
  const pnlClass = value => value === null || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative';
  const shortMint = mint => mint.slice(0, 5) + '…' + mint.slice(-5);
  const date = (value, full=false) => value ? new Intl.DateTimeFormat('en-GB', {day:'2-digit',month:'short',...(full?{year:'numeric'}:{}),hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(value)) + (full?' UTC':'') : '—';
  const tokenName = trade => trade.symbol || trade.name || shortMint(trade.mint);
  const state = {unlocked:false,data:null,view:'overview',filter:'all',version:'all',query:'',sort:'time',direction:-1,page:1,pageSize:10,refreshing:false,chartTrades:[],drawerId:null};
  let refreshTimer, fetchController, toastTimer, priorFocus, requestGeneration=0;
  const storage = {get:()=>{try{return sessionStorage.getItem('bread-journal-open')==='yes';}catch{return false;}},set:value=>{try{value?sessionStorage.setItem('bread-journal-open','yes'):sessionStorage.removeItem('bread-journal-open');}catch{}}};

  function normalize(payload) {
    if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.trades) || payload.trades.length > 10000) throw new Error('This export has an unsupported format.');
    const seen = new Set();
    const trades = payload.trades.map((row,index) => {
      if (!row || typeof row.mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint) || !['closed','open','unresolved'].includes(row.status)) throw new Error('This export contains an invalid trade record.');
      const id = typeof row.id === 'string' && row.id.length <= 200 ? row.id : `${row.mint}:${index}`;
      if(seen.has(id)) throw new Error('This export contains a duplicate trade.'); seen.add(id);
      const cleanText = (value,max) => typeof value==='string'&&value.length<=max&&!/[\r\n\0]/.test(value)?value:null;
      return {id,botVersion:typeof row.botVersion==='string'&&/^\d+\.\d+\.\d+$/.test(row.botVersion)?row.botVersion:null,mint:row.mint,name:cleanText(row.name,128),symbol:cleanText(row.symbol,32),status:row.status,
        entryMarketCapUsd:finite(row.entryMarketCapUsd)&&row.entryMarketCapUsd>=0?row.entryMarketCapUsd:null,
        exitMarketCapUsd:row.status==='closed'&&finite(row.exitMarketCapUsd)&&row.exitMarketCapUsd>=0?row.exitMarketCapUsd:null,
        pnlPercent:row.status==='closed'&&finite(row.pnlPercent)?row.pnlPercent:null,
        openedAt:validDate(row.openedAt),closedAt:row.status==='closed'?validDate(row.closedAt):null};
    });
    return {versions:Array.isArray(payload.versions)?payload.versions.filter(v=>v&&typeof v.version==='string'&&/^\d+\.\d+\.\d+$/.test(v.version)).slice(-100):[],updatedAt:validDate(payload.updatedAt),live:payload.live&&typeof payload.live==='object'?payload.live:{},stats:payload.stats&&typeof payload.stats==='object'?payload.stats:{},trades};
  }
  function unlock() {
    if(state.unlocked)return;
    state.unlocked=true;storage.set(true);$('password').value='';$('gate-error').textContent='';$('gate').hidden=true;$('app').hidden=false;
    setView(location.hash==='#journal'?'journal':'overview',false);loadData();refreshTimer=setInterval(loadData,30000);
  }
  function logout() {
    state.unlocked=false;requestGeneration++;storage.set(false);clearInterval(refreshTimer);fetchController?.abort();state.refreshing=false;$('refresh').classList.remove('refreshing');closeDrawer(false);
    state.data=null;state.chartTrades=[];state.query='';state.filter='all';state.version='all';state.page=1;$('search').value='';$('version-filter').replaceChildren();$('version-history').replaceChildren();
    ['trade-rows','metrics','performance-chart','status-summary','runner-state'].forEach(id=>$(id).replaceChildren());
    $('chart-tooltip').replaceChildren();$('chart-tooltip').hidden=true;$('trade-count').textContent='';
    document.querySelectorAll('[data-count]').forEach(node=>node.textContent='0');$('page-summary').textContent='';$('page-number').textContent='';
    $('export-time').textContent='Checks every 30 seconds · exports arrive in batches.';
    $('connection').className='connection';$('connection').innerHTML='<span></span> Waiting for export';
    $('data-content').hidden=true;$('data-error').hidden=true;$('loading').hidden=false;$('notice').hidden=true;
    $('app').hidden=true;$('gate').hidden=false;document.body.classList.remove('journal-view');$('password').focus();
  }
  async function fetchExport(url,signal) {
    const target=new URL(url,location.href);if(!['http:','https:'].includes(target.protocol))throw new Error('Serve this journal over HTTP to read its data.');
    target.searchParams.set('v',String(Math.floor(Date.now()/30000)));
    const response=await fetch(target,{cache:'no-store',credentials:'omit',signal});
    if(!response.ok)throw new Error(`The trade export returned ${response.status}.`);
    const content=await response.text();if(content.length>5000000)throw new Error('The trade export is too large.');
    return normalize(JSON.parse(content));
  }
  async function loadData() {
    if(!state.unlocked||state.refreshing)return;state.refreshing=true;$('refresh').classList.add('refreshing');
    const generation=++requestGeneration,controller=new AbortController();fetchController=controller;
    const timeout=setTimeout(()=>controller.abort(),10000);let fallback=false;
    try {
      const configured=typeof window.BREAD_DATA_URL==='string'&&window.BREAD_DATA_URL.trim()?window.BREAD_DATA_URL:'./data/trades.json';
      let data;
      try{data=await fetchExport(configured,controller.signal);}catch(error){
        if(state.data||configured==='./data/trades.json'||controller.signal.aborted)throw error;
        data=await fetchExport('./data/trades.json',controller.signal);fallback=true;
      }
      if(!state.unlocked||generation!==requestGeneration)return;state.data=data;$('loading').hidden=true;$('data-error').hidden=true;$('data-content').hidden=false;
      $('notice').hidden=!fallback;$('notice').textContent=fallback?'The remote feed is unavailable. Showing the bundled export below.':'';
      render();
    } catch(error) {
      if(!state.unlocked||generation!==requestGeneration)return;
      $('loading').hidden=true;
      if(state.data){$('notice').hidden=false;$('notice').textContent='Couldn’t refresh. The last successfully loaded export is still shown.';$('connection').className='connection stale';$('connection').innerHTML='<span></span> Refresh unavailable';}
      else{$('data-error').hidden=false;$('data-content').hidden=true;$('error-message').textContent=error.name==='AbortError'?'The export took too long to respond. Please try again.':error.message||'We couldn’t read the latest trade export.';}
    } finally{clearTimeout(timeout);if(generation===requestGeneration){state.refreshing=false;$('refresh').classList.remove('refreshing');}}
  }
  function setView(view,updateHash=true) {
    state.view=view==='journal'?'journal':'overview';state.page=1;document.body.classList.toggle('journal-view',state.view==='journal');
    document.querySelectorAll('.nav-item').forEach(button=>{const active=button.dataset.view===state.view;button.classList.toggle('active',active);active?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');});
    $('breadcrumb').textContent=state.view==='journal'?'TRADE JOURNAL':'OVERVIEW';
    $('page-eyebrow').textContent=state.view==='journal'?'02 / THE TRADE JOURNAL':'01 / THE OVERVIEW';
    $('page-title').innerHTML=state.view==='journal'?'The full record<span>.</span>':'Paper, on record<span>.</span>';
    $('page-description').textContent=state.view==='journal'?'A closer look at every recorded position.':'Every entry. Every exit. A clearer picture.';
    $('overview-section').hidden=state.view==='journal';$('ledger-eyebrow').textContent=state.view==='journal'?'THE RUNNING RECORD':'THE LATEST ENTRIES';
    if(updateHash)history.replaceState(null,'','#'+state.view);if(state.data)renderRows();
  }
  function versionTrades(){return state.data.trades.filter(t=>state.version==='all'||(t.botVersion||'legacy')===state.version);}
  function renderVersions(){
    const versions=[...new Set([...state.data.versions.map(v=>v.version),...state.data.trades.map(t=>t.botVersion).filter(Boolean)])];
    if(state.version!=='all'&&state.version!=='legacy'&&!versions.includes(state.version))state.version='all';
    const options=[['all','All versions'],...versions.map(v=>[v,'v'+v]),...(state.data.trades.some(t=>!t.botVersion)?[['legacy','Before versioning']]:[])];
    $('version-filter').innerHTML=options.map(([v,label])=>'<option value="'+escape(v)+'">'+escape(label)+'</option>').join('');$('version-filter').value=state.version;
    $('version-history').innerHTML=state.data.versions.length?state.data.versions.slice().reverse().map(v=>'<article class="release-row"><strong>v'+escape(v.version)+(v.active?' <small>Current</small>':'')+'</strong><time>'+date(validDate(v.registeredAt),true)+'</time><p>'+escape(typeof v.summary==='string'?v.summary.slice(0,240):'Bot release')+'</p></article>').join(''):'<p>Release tracking is being initialized.</p>';
  }
  function render() {
    renderVersions();const {stats,live,updatedAt}=state.data,trades=versionTrades(),closed=trades.filter(t=>t.status==='closed'),known=closed.filter(t=>t.pnlPercent!==null);
    const mean=known.length?known.reduce((sum,t)=>sum+t.pnlPercent,0)/known.length:null;
    const winRate=known.length?known.filter(t=>t.pnlPercent>0).length/known.length*100:null;
    const unresolved=trades.filter(t=>t.status==='unresolved').length,open=trades.filter(t=>t.status==='open').length;
    const metrics=[
      {label:'Closed trades',value:String(closed.length),note:'The completed record',marker:'01'},
      {label:'Average PnL',value:percent(mean),note:`${known.length} known executed returns`,marker:'02',color:pnlClass(mean)},
      {label:'Win rate',value:winRate===null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(winRate)+'%',note:'Profitable / known closes',marker:'03'},
      {label:'Unresolved',value:String(unresolved),note:unresolved?'Inventory still awaiting resolution':'No unresolved positions',marker:'04'}];
    $('metrics').innerHTML=metrics.map(m=>`<div class="metric"><div class="metric-label">${m.label}<span class="metric-marker">[ ${m.marker} ]</span></div><div class="metric-value ${m.color||''}">${m.value}</div><div class="metric-note">${m.note}</div></div>`).join('');
    const rawState=typeof live.state==='string'?live.state.toLowerCase():'';
    let runner='Status unavailable';
    if(rawState==='awaiting_recovery')runner='Awaiting position recovery.';
    else if(rawState==='draining_virtual_position'||rawState==='draining')runner='Closing paper positions.';
    else if(rawState.includes('stopped')||rawState==='idle'||rawState==='terminal')runner='Paper runner stopped.';
    else if(['running','paper_running','observing_axiom_paper_only','trading'].includes(rawState))runner='Paper session active.';
    else if(rawState.includes('quote')||rawState.includes('monitor'))runner='Quote observation only.';
    $('runner-state').textContent=runner;
    $('status-summary').innerHTML=`<div><span>Closed positions</span><b>${closed.length}</b></div><div><span>Open positions</span><b>${open}</b></div><div><span>Unresolved positions</span><b>${unresolved}</b></div>`;
    const age=updatedAt?Math.max(0,Date.now()-Date.parse(updatedAt)):Infinity;
    $('connection').className='connection '+(age<=300000?'fresh':'stale');
    $('connection').innerHTML='<span></span>'+(!updatedAt?'Snapshot time unknown':age<60000?'Snapshot just now':`Snapshot ${Math.floor(age/60000)}m ago`);
    $('export-time').textContent=updatedAt?`Snapshot recorded ${date(updatedAt,true)} · checks every 30s`:'Checks every 30s · snapshot time unavailable';
    const counts={all:trades.length,closed:closed.length,open,unresolved};
    document.querySelectorAll('[data-count]').forEach(node=>node.textContent=counts[node.dataset.count]);
    $('trade-count').textContent=trades.length;renderChart(known);renderRows();
    if(state.drawerId){const trade=trades.find(t=>t.id===state.drawerId);if(trade)renderDrawer(trade);else closeDrawer();}
  }
  function renderChart(closed) {
    const trades=[...closed].sort((a,b)=>Date.parse(a.closedAt||a.openedAt||0)-Date.parse(b.closedAt||b.openedAt||0)).slice(-40);state.chartTrades=trades;
    $('chart-empty').hidden=trades.length!==0;$('performance-chart').style.opacity=trades.length?'1':'.45';
    const values=trades.map(t=>t.pnlPercent),minimum=values.length?Math.floor(Math.min(0,...values)/10)*10:-50;
    let maximum=values.length?Math.ceil(Math.max(0,...values)/10)*10:10;if(maximum===minimum)maximum=minimum+10;
    const left=47,right=784,top=18,bottom=238,x=index=>trades.length===1?(left+right)/2:left+index/(trades.length-1)*(right-left),y=value=>bottom-(value-minimum)/(maximum-minimum)*(bottom-top);
    const ticks=Array.from({length:5},(_,i)=>minimum+(maximum-minimum)*i/4);
    let svg='<defs><linearGradient id="chart-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c46632" stop-opacity=".03"/><stop offset="1" stop-color="#c46632" stop-opacity=".12"/></linearGradient></defs>';
    svg+=ticks.map(t=>`<line x1="${left}" x2="${right}" y1="${y(t)}" y2="${y(t)}" class="chart-grid ${t===0?'chart-zero':''}"/><text x="${left-11}" y="${y(t)+3}" text-anchor="end" class="chart-axis">${t>0?'+':''}${Number(t.toFixed(1))}%</text>`).join('');
    if(trades.length){const line=values.map((v,i)=>`${i?'L':'M'} ${x(i)} ${y(v)}`).join(' ');
      if(trades.length>1)svg+=`<path class="chart-area" d="M ${x(0)} ${y(0)} ${values.map((v,i)=>`L ${x(i)} ${y(v)}`).join(' ')} L ${x(trades.length-1)} ${y(0)} Z"/>`;
      svg+=`<path d="${line}" class="chart-line"/>`;
      svg+=trades.map((trade,i)=>`<circle class="chart-point" cx="${x(i)}" cy="${y(trade.pnlPercent)}" r="${i===trades.length-1?4:3}" data-index="${i}" tabindex="0" role="button" aria-label="${escape(tokenName(trade))}, ${percent(trade.pnlPercent)}. Open trade details."/>`).join('');
      svg+=`<text class="chart-axis" x="${left}" y="268">CLOSE ${Math.max(1,closed.length-trades.length+1).toString().padStart(2,'0')}</text><text class="chart-axis" x="${right}" y="268" text-anchor="end">${trades.length===1?'1 RECORDED CLOSE':`CLOSE ${closed.length.toString().padStart(2,'0')}`}</text>`;
    }
    $('performance-chart').innerHTML=svg;
    $('performance-chart').setAttribute('aria-label',trades.length?`${trades.length} closed trades, executed PnL sequence. Fees excluded.`:'No known closed trade returns to plot.');
  }
  function visibleTrades() {
    const query=state.query.trim().toLowerCase();
    return versionTrades().filter(t=>(state.filter==='all'||t.status===state.filter)&&(!query||[t.mint,t.name,t.symbol].some(v=>v?.toLowerCase().includes(query))))
      .sort((a,b)=>{const av=state.sort==='time'?Date.parse(a.closedAt||a.openedAt||''):a[state.sort],bv=state.sort==='time'?Date.parse(b.closedAt||b.openedAt||''):b[state.sort];
        if(av===null||!Number.isFinite(av))return bv===null||!Number.isFinite(bv)?a.id.localeCompare(b.id):1;
        if(bv===null||!Number.isFinite(bv))return-1;return(av-bv)*state.direction||a.id.localeCompare(b.id);});
  }
  function renderRows() {
    if(!state.data)return;const trades=visibleTrades(),pages=Math.max(1,Math.ceil(trades.length/state.pageSize));state.page=Math.min(state.page,pages);
    const offset=(state.page-1)*state.pageSize,rows=trades.slice(offset,offset+state.pageSize);
    $('trade-rows').innerHTML=rows.map(t=>`<tr data-trade-id="${escape(t.id)}"><td><button class="token-trigger" data-trade-id="${escape(t.id)}"><span class="token-avatar" aria-hidden="true">${escape((t.symbol||t.name||t.mint).slice(0,1).toUpperCase())}</span><span><span class="token-title">${escape(tokenName(t))}${t.symbol&&t.name?`<span class="token-ticker">${escape(t.name)}</span>`:''}</span><span class="token-ca">${escape(shortMint(t.mint))}</span><span class="trade-version">${t.botVersion?"v"+escape(t.botVersion):"Before versioning"}</span></span></button></td><td><span class="status ${t.status}">${t.status[0].toUpperCase()+t.status.slice(1)}</span></td><td class="numeric">${price(t.entryMarketCapUsd)}</td><td class="numeric">${price(t.exitMarketCapUsd)}</td><td class="numeric pnl-cell ${pnlClass(t.pnlPercent)}">${percent(t.pnlPercent)}</td><td class="recorded-cell">${date(t.closedAt||t.openedAt)}</td><td><svg class="icon row-arrow"><use href="#i-chevron"/></svg></td></tr>`).join('');
    $('ledger-empty').hidden=trades.length!==0;$('empty-description').textContent=state.data.trades.length?'Try a different contract address or status.':'No trades have been included in this export yet.';
    $('clear-filters').hidden=!state.query&&state.filter==='all'&&state.version==='all';
    $('page-summary').textContent=trades.length?`${offset+1}–${Math.min(offset+state.pageSize,trades.length)} of ${trades.length} trades`:'0 trades';
    $('page-number').textContent=`${state.page} / ${pages}`;$('previous-page').disabled=state.page<=1;$('next-page').disabled=state.page>=pages;
    document.querySelectorAll('[data-filter]').forEach(button=>{const active=button.dataset.filter===state.filter;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    document.querySelectorAll('[data-sort]').forEach(button=>{const active=button.dataset.sort===state.sort;button.classList.toggle('sort-current',active);button.querySelector('span').textContent=active?(state.direction===1?'↑':'↓'):'↕';button.closest('th').setAttribute('aria-sort',active?(state.direction===1?'ascending':'descending'):'none');});
  }
  function renderDrawer(trade) {
    const explanation=trade.status==='unresolved'?'This position is unresolved. Its held inventory has no recorded completed exit, so realized PnL remains unknown.':trade.status==='open'?'This position is still open. An exit market cap and realized PnL are not available yet.':'PnL compares actual executed gross exit proceeds with actual entry principal. Fees are excluded.';
    $('drawer-content').innerHTML=`<div class="drawer-identity"><span class="token-avatar">${escape((trade.symbol||trade.name||trade.mint).slice(0,1).toUpperCase())}</span><div><h2 id="drawer-title">${escape(tokenName(trade))}</h2><small>${trade.symbol&&trade.name?escape(trade.name):'SOLANA / PAPER POSITION'}</small></div></div><span class="status ${trade.status}">${trade.status[0].toUpperCase()+trade.status.slice(1)}</span><div class="drawer-pnl"><span class="eyebrow">EXECUTED PNL</span><strong class="${pnlClass(trade.pnlPercent)}">${percent(trade.pnlPercent)}</strong><small>${trade.pnlPercent===null?'No realized return recorded':'Executed price return · fees excluded'}</small></div><dl class="drawer-caps"><div><dt>Entry market cap</dt><dd>${price(trade.entryMarketCapUsd)}</dd></div><div><dt>Exit market cap</dt><dd>${price(trade.exitMarketCapUsd)}</dd></div></dl><div class="drawer-ca"><div class="drawer-ca-label">Contract address</div><div class="ca-control"><code>${escape(trade.mint)}</code><button class="icon-button" id="copy-ca" aria-label="Copy contract address">${icons('copy')}</button></div></div><dl class="drawer-times"><div><dt>Opened</dt><dd>${date(trade.openedAt,true)}</dd></div><div><dt>Closed</dt><dd>${date(trade.closedAt,true)}</dd></div></dl><p class="drawer-explanation">${explanation}</p>`;
    const mcNote=document.createElement('p');mcNote.className='drawer-mc-note';mcNote.textContent='USD market caps use cached display-time SOL/USD.';
    $('drawer-content').querySelector('.drawer-caps').after(mcNote);
    const version=document.createElement('p');version.className='drawer-version';version.textContent='Bot at entry: '+(trade.botVersion?'v'+trade.botVersion:'Before versioning');$('drawer-content').append(version);
    $('copy-ca').addEventListener('click',()=>copy(trade.mint));
  }
  function openDrawer(id) {
    const trade=state.data?.trades.find(t=>t.id===id);if(!trade)return;priorFocus=document.activeElement;state.drawerId=id;renderDrawer(trade);
    $('trade-drawer').hidden=false;$('drawer-backdrop').hidden=false;$('app').inert=true;document.body.classList.add('is-locked');$('close-drawer').focus();
  }
  function closeDrawer(restore=true) {
    state.drawerId=null;$('trade-drawer').hidden=true;$('drawer-backdrop').hidden=true;$('app').inert=false;document.body.classList.remove('is-locked');$('drawer-content').replaceChildren();
    if(restore&&priorFocus?.isConnected)priorFocus.focus();
  }
  async function copy(value) {
    try{await navigator.clipboard.writeText(value);notify('Contract address copied.');}catch{notify('Copy unavailable. Select the address to copy it.');}
  }
  function notify(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2600);}
  function chartTooltip(target) {
    const trade=state.chartTrades[Number(target.dataset.index)];if(!trade)return;
    const bounds=$('chart-wrap').getBoundingClientRect(),point=target.getBoundingClientRect();
    $('chart-tooltip').innerHTML=`<strong>${percent(trade.pnlPercent)}</strong><small>${escape(tokenName(trade))}</small>`;
    $('chart-tooltip').style.left=Math.max(65,Math.min(bounds.width-65,point.left-bounds.left+point.width/2))+'px';$('chart-tooltip').style.top=point.top-bounds.top-10+'px';$('chart-tooltip').hidden=false;
  }
  $('unlock-form').addEventListener('submit',event=>{event.preventDefault();if($('password').value==='123')unlock();else{$('gate-error').textContent='That password doesn’t match. Try again.';$('password').setAttribute('aria-invalid','true');$('password').focus();$('password').select();}});
  $('password').addEventListener('input',()=>{$('gate-error').textContent='';$('password').removeAttribute('aria-invalid');});
  $('show-password').addEventListener('click',()=>{const show=$('password').type==='password';$('password').type=show?'text':'password';$('show-password').setAttribute('aria-pressed',String(show));$('show-password').setAttribute('aria-label',show?'Hide password':'Show password');});
  ['logout','logout-mobile'].forEach(id=>$(id).addEventListener('click',logout));['refresh','retry'].forEach(id=>$(id).addEventListener('click',loadData));
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();if(state.unlocked)setView(button.dataset.view);}));
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{state.filter=button.dataset.filter;state.page=1;renderRows();}));
  document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{state.direction=state.sort===button.dataset.sort?-state.direction:-1;state.sort=button.dataset.sort;state.page=1;renderRows();}));
  $('search').addEventListener('input',()=>{state.query=$('search').value;state.page=1;if(state.view!=='journal')setView('journal');else renderRows();});
  $('page-size').addEventListener('change',()=>{state.pageSize=Number($('page-size').value);state.page=1;renderRows();});
  $('previous-page').addEventListener('click',()=>{state.page--;renderRows();});$('next-page').addEventListener('click',()=>{state.page++;renderRows();});
  $('clear-filters').addEventListener('click',()=>{state.query='';state.filter='all';state.version='all';state.page=1;$('search').value='';render();});
  $('version-filter').addEventListener('change',()=>{state.version=$('version-filter').value;state.page=1;render();});
  $('trade-rows').addEventListener('click',event=>{const row=event.target.closest('[data-trade-id]');if(row)openDrawer(row.dataset.tradeId);});
  $('close-drawer').addEventListener('click',()=>closeDrawer());$('drawer-backdrop').addEventListener('click',()=>closeDrawer());
  $('performance-chart').addEventListener('mouseover',event=>{if(event.target.matches('[data-index]'))chartTooltip(event.target);});
  $('performance-chart').addEventListener('focusin',event=>{if(event.target.matches('[data-index]'))chartTooltip(event.target);});
  $('performance-chart').addEventListener('mouseout',()=>$('chart-tooltip').hidden=true);$('performance-chart').addEventListener('focusout',()=>$('chart-tooltip').hidden=true);
  $('performance-chart').addEventListener('click',event=>{if(event.target.matches('[data-index]'))openDrawer(state.chartTrades[Number(event.target.dataset.index)].id);});
  document.addEventListener('keydown',event=>{
    if(state.drawerId){
      if(event.key==='Escape'){event.preventDefault();closeDrawer();}
      if(event.key==='Tab'){const nodes=$('trade-drawer').querySelectorAll('button,a[href],input,select,[tabindex="0"]'),first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
      return;
    }
    if(!state.unlocked)return;
    if((event.key==='/'||((event.ctrlKey||event.metaKey)&&event.key==='k'))&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('search').focus();}
    if((event.key==='Enter'||event.key===' ')&&document.activeElement.matches('.chart-point')){event.preventDefault();openDrawer(state.chartTrades[Number(document.activeElement.dataset.index)].id);}
  });
  if(storage.get())unlock();
})();
