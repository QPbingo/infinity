var fe=Object.defineProperty;var he=(e,t,s)=>t in e?fe(e,t,{enumerable:!0,configurable:!0,writable:!0,value:s}):e[t]=s;var m=(e,t,s)=>he(e,typeof t!="symbol"?t+"":t,s);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))o(n);new MutationObserver(n=>{for(const a of n)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function s(n){const a={};return n.integrity&&(a.integrity=n.integrity),n.referrerPolicy&&(a.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?a.credentials="include":n.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function o(n){if(n.ep)return;n.ep=!0;const a=s(n);fetch(n.href,a)}})();const ve="modulepreload",ye=function(e){return"/"+e},q={},j=function(t,s,o){let n=Promise.resolve();if(s&&s.length>0){document.getElementsByTagName("link");const i=document.querySelector("meta[property=csp-nonce]"),c=(i==null?void 0:i.nonce)||(i==null?void 0:i.getAttribute("nonce"));n=Promise.allSettled(s.map(l=>{if(l=ye(l),l in q)return;q[l]=!0;const h=l.endsWith(".css"),u=h?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${l}"]${u}`))return;const r=document.createElement("link");if(r.rel=h?"stylesheet":ve,h||(r.as="script"),r.crossOrigin="",r.href=l,c&&r.setAttribute("nonce",c),document.head.appendChild(r),h)return new Promise((f,k)=>{r.addEventListener("load",f),r.addEventListener("error",()=>k(new Error(`Unable to preload CSS for ${l}`)))})}))}function a(i){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=i,window.dispatchEvent(c),!c.defaultPrevented)throw i}return n.then(i=>{for(const c of i||[])c.status==="rejected"&&a(c.reason);return t().catch(a)})},ee="",ge="/api/events/stream",z=we();let be=1;const T=[];function we(){if(typeof document>"u")return null;let e=document.getElementById("toast-container");return e||(e=document.createElement("div"),e.id="toast-container",e.setAttribute("role","status"),e.setAttribute("aria-live","polite"),document.body.appendChild(e),e)}function M(e,t,s=5e3){if(!z)return;const o=be++,n=document.createElement("div");n.className=`toast ${e}`,n.innerHTML='<span class="toast-msg"></span><button class="toast-close" aria-label="Dismiss">×</button>',n.querySelector(".toast-msg").textContent=t,n.querySelector(".toast-close").onclick=()=>O(o),z.appendChild(n);let a=null;if(s>0&&(a=setTimeout(()=>O(o),s)),T.push({id:o,el:n,timer:a}),T.length>5){const i=T.shift();i&&(i.timer&&clearTimeout(i.timer),i.el.remove())}}function O(e){const t=T.findIndex(o=>o.id===e);if(t<0)return;const s=T[t];T.splice(t,1),s.timer&&clearTimeout(s.timer),s.el.style.opacity="0",s.el.style.transform="translateX(12px)",setTimeout(()=>s.el.remove(),200)}const v={ok:e=>M("ok",e,4e3),info:e=>M("info",e,5e3),warn:e=>M("warn",e,0),error:e=>M("error",e,0),dismiss:O};class V extends Error{constructor(t,s){super(s),this.status=t,this.name="HTTPError"}}const N="auth:unauthorized";function ke(e){const t=()=>e();return window.addEventListener(N,t),()=>window.removeEventListener(N,t)}function Ee(){window.dispatchEvent(new CustomEvent(N))}async function g(e,t={}){var o;let s;try{s=await fetch(ee+e,{credentials:"include",headers:{"Content-Type":"application/json",...t.headers??{}},...t})}catch(n){throw v.error("Network error — is the daemon running on :9101?"),n}if(s.status!==204){if(s.status===401)throw Ee(),new V(401,"Session expired");if(!s.ok){let n=`HTTP ${s.status}`;try{const a=await s.json();a!=null&&a.error&&(n=a.error)}catch{}throw new V(s.status,n)}if((o=s.headers.get("content-type"))!=null&&o.includes("application/json"))return await s.json()}}async function _e(e,t){return(await g("/api/auth/register",{method:"POST",body:JSON.stringify({username:e,password:t})})).user}async function Ie(e,t){return(await g("/api/auth/login",{method:"POST",body:JSON.stringify({username:e,password:t})})).user}async function xe(){await g("/api/auth/logout",{method:"POST"})}async function Te(){try{const e=await g("/api/auth/me",{method:"GET"});return(e==null?void 0:e.user)??null}catch{return null}}class B{constructor(){m(this,"listeners",new Set)}subscribe(t){return this.listeners.add(t),()=>this.listeners.delete(t)}notify(){for(const t of this.listeners)try{t()}catch{}}}class Se extends B{constructor(){super(...arguments);m(this,"user",null);m(this,"authed",!1)}setUser(s){this.user=s,this.authed=s!==null,this.notify()}clear(){this.user=null,this.authed=!1,this.notify()}}const w=new Se;function L(e="login"){const t=document.getElementById("auth-overlay"),s=document.getElementById("app");!t||!s||(s.classList.remove("is-ready"),t.style.display="flex",t.innerHTML=$e(e),Be(e))}function $e(e){const t=e==="login";return`<div class="auth-box">
    <h2>${t?"Sign In":"Create Account"}</h2>
    <div class="error" id="auth-error" style="display:none"></div>
    <input type="text" id="auth-username" placeholder="Username" autocomplete="username" autofocus>
    <input type="password" id="auth-password" placeholder="Password" autocomplete="${t?"current-password":"new-password"}">
    ${t?"":'<input type="password" id="auth-password2" placeholder="Confirm password" autocomplete="new-password">'}
    <button id="auth-submit">${t?"Sign In":"Create Account"}</button>
    <div class="switch">
      ${t?`Don't have an account? <a id="auth-toggle">Sign up</a>`:'Already have an account? <a id="auth-toggle">Sign in</a>'}
    </div>
  </div>`}function Be(e){const t=document.getElementById("auth-toggle");t&&(t.onclick=()=>L(e==="login"?"register":"login"));const s=document.getElementById("auth-submit");s&&(s.onclick=()=>e==="login"?Ce():Le(),s.onkeydown=n=>{n.key==="Enter"&&s.click()});const o=document.getElementById("auth-overlay");o&&(o.onkeydown=n=>{var a;n.key==="Enter"&&((a=document.getElementById("auth-submit"))==null||a.click())})}function S(e){const t=document.getElementById("auth-error");t&&(t.textContent=e,t.style.display="block")}async function Le(){var o,n,a;const e=((o=document.getElementById("auth-username"))==null?void 0:o.value.trim())??"",t=(n=document.getElementById("auth-password"))==null?void 0:n.value,s=(a=document.getElementById("auth-password2"))==null?void 0:a.value;if(!e||!t){S("Username and password required");return}if(t!==s){S("Passwords do not match");return}try{const i=await _e(e,t);w.setUser(i),C(),v.ok(`Welcome, ${i.username}`)}catch(i){S(i.message||"Registration failed")}}async function Ce(){var s,o;const e=((s=document.getElementById("auth-username"))==null?void 0:s.value.trim())??"",t=(o=document.getElementById("auth-password"))==null?void 0:o.value;if(!e||!t){S("Username and password required");return}try{const n=await Ie(e,t);w.setUser(n),C(),v.ok(`Welcome back, ${n.username}`)}catch(n){S(n.message||"Invalid credentials")}}async function te(){try{await xe()}catch{}w.clear(),L("login"),v.info("Signed out")}function C(){const e=document.getElementById("auth-overlay"),t=document.getElementById("app");e&&(e.style.display="none"),t&&t.classList.add("is-ready")}async function se(e){const t=await Te();t?(w.setUser(t),C()):L("login"),e()}function ne(){ke(()=>{w.clear(),L("login"),v.warn("Session expired — please sign in again")})}const Pe=Object.freeze(Object.defineProperty({__proto__:null,doLogout:te,renderAuth:L,restoreSession:se,showApp:C,wireUnauthorizedAutoLogout:ne},Symbol.toStringTag,{value:"Module"}));class Me extends B{constructor(){super(...arguments);m(this,"executions",[]);m(this,"currentExecId",null)}applyEvent(s){switch(s.type){case"agent_executions":{const o=s.executions??[];this.executions=o.map(n=>({...n,messages:n.messages??[]})),this.notify();break}case"agent_exec_started":{const o=s.exec_id;this.executions.find(n=>n.id===o)||this.executions.unshift({id:o,agent_type:s.agent_type,session_id:s.session_id,prompt:s.prompt,status:"running",messages:[],created_at:new Date().toISOString()}),this.notify();break}case"agent_session_created":{this.notify();break}case"agent_message":{const o=s.exec_id??this.currentExecId,n=this.executions.find(a=>a.id===o);n&&(n.messages.push({type:s.msg_type,content:s.content,tool_name:s.tool_name,tool_input:s.tool_input}),s.is_final&&(n.status="completed")),this.notify();break}case"agent_error":{const o=s.exec_id??this.currentExecId,n=this.executions.find(a=>a.id===o);n&&(n.status="error",n.error=s.error),this.notify();break}case"agent_cancelled":{const o=s.exec_id,n=this.executions.find(a=>a.id===o);n&&(n.status="cancelled"),this.notify();break}}}setCurrent(s){this.currentExecId=s,this.notify()}}const _=new Me;class je extends B{constructor(){super(...arguments);m(this,"tree",null);m(this,"selectedWorkspaceId",null);m(this,"selectedTopicId",null);m(this,"selectedStoryId",null);m(this,"selectedTopicName","");m(this,"expandedNodes",{})}setTree(s){var o;this.tree=s,this.selectedWorkspaceId===null&&((o=s.workspaces)!=null&&o.length)&&(this.selectedWorkspaceId=s.workspaces[0].workspace.id),this.notify()}applyEvent(s){(s.type==="hierarchy_snapshot"||s.type==="hierarchy_updated")&&this.setTree(s.hierarchy)}selectWorkspace(s){this.selectedWorkspaceId=s,this.selectedTopicId=null,this.selectedStoryId=null,this.notify()}selectTopic(s,o){this.selectedTopicId=s,this.selectedStoryId=null,this.selectedTopicName=o,this.expandedNodes["topic_"+s]=!0,this.notify()}selectStory(s){this.selectedStoryId=s,this.selectedTopicId=null,this.notify()}toggleNode(s){const o=this.expandedNodes[s]!==!1;this.expandedNodes[s]=!o,this.notify()}}const d=new je,oe=["active","idle","stopped","disappeared","unknown","error"];class Ae extends B{constructor(){super(...arguments);m(this,"sessions",{});m(this,"currentFilter","all");m(this,"agentTypeFilter","");m(this,"selectedSessionKey",null);m(this,"expandedCards",{});m(this,"expandedTurns",{});m(this,"expandedToolGroups",{});m(this,"expandedPayloads",{});m(this,"draftInputs",{});m(this,"timelineSearch",{});m(this,"timelineTurnFilter",{})}applyEvent(s){switch(s.type){case"snapshot":{this.sessions={};const o=s.sessions??[];for(const n of o)this.sessions[n.session_key]=n;this.notify();break}case"session_added":{const o=s.session;o&&(this.sessions[o.session_key]=o),this.notify();break}case"delta":{this.applyDelta(s);break}}}applyDelta(s){const o=s.session_key,n=s.changes;if(!o||!n)return;const a=this.sessions[o];if(!a)return;const i={...a};for(const c of Object.keys(n)){if(c==="turns"){const l=n.turns;i.turns=He(a.turns??[],l);continue}i[c]=n[c]}this.sessions[o]=i,this.notify()}setFilter(s){this.currentFilter=s,this.notify()}setAgentTypeFilter(s){this.agentTypeFilter=s,this.notify()}setDraftInput(s,o){this.draftInputs[s]=o}setTimelineSearch(s,o){this.timelineSearch[s]=o,this.notify()}setTimelineTurnFilter(s,o){this.timelineTurnFilter[s]=o,this.notify()}toggleCard(s){this.expandedCards[s]=!this.expandedCards[s],this.notify()}toggleTurn(s,o){const n=`${s}_turn_${o}`;this.expandedTurns[n]=!this.expandedTurns[n],this.notify()}toggleToolGroup(s,o,n){const a=`${s}_${o}_${n}`;this.expandedToolGroups[a]=!this.expandedToolGroups[a],this.notify()}toggleToolDetail(s){this.expandedToolGroups[s]=!this.expandedToolGroups[s],this.notify()}toggleEntryPayload(s,o,n){const a=`${s}_${o}_${n}`;this.expandedPayloads[a]=!this.expandedPayloads[a],this.notify()}togglePayload(s){this.expandedPayloads[s]=!this.expandedPayloads[s],this.notify()}filteredList(s,o){let n=Object.values(this.sessions);return o?n=n.filter(a=>a.session_key===o):s&&s.size>0?n=n.filter(a=>s.has(a.session_key)):s&&(n=[]),this.currentFilter!=="all"&&Oe(this.currentFilter)?n=n.filter(a=>a.status===this.currentFilter):this.currentFilter!=="all"&&Ne(this.currentFilter)&&(n=n.filter(a=>a.agent_type===this.currentFilter)),this.agentTypeFilter&&(n=n.filter(a=>a.agent_type===this.agentTypeFilter)),n.sort((a,i)=>i.last_event_time_ms-a.last_event_time_ms),n}statusCounts(){const s={};for(const o of Object.values(this.sessions))s[o.status]=(s[o.status]??0)+1;return s}agentTypeCounts(){const s={};for(const o of Object.values(this.sessions))s[o.agent_type]=(s[o.agent_type]??0)+1;return s}}function Oe(e){return oe.includes(e)}function Ne(e){return e==="claude"||e==="opencode"||e==="codex"}function He(e,t){if(!t||t.length===0)return e;if(e.length===0)return t.slice();const s=new Map;for(const n of e)s.set(n.turn_idx,n);for(const n of t)s.set(n.turn_idx,{...n});const o=Array.from(s.values());return o.sort((n,a)=>n.turn_idx-a.turn_idx),o}const y=new Ae,We=6e4;class De extends B{constructor(){super(...arguments);m(this,"_current","disconnected")}current(){return this._current}set(s){s!==this._current&&(this._current=s,this.notify())}}const E=new De;class Ue{constructor(){m(this,"es",null);m(this,"handlers",new Set);m(this,"deadTimer",null);m(this,"bc",null);m(this,"leaderHeartbeat",null);m(this,"followerWait",null);m(this,"isLeader",!1);m(this,"disposed",!1);m(this,"closeRetries",0);this.initBroadcastChannel()}connect(){this.disposed||(E.set("connecting"),this.bc?(this.bc.postMessage({kind:"whois_leader"}),this.followerWait=setTimeout(()=>this.becomeLeader(),500)):this.becomeLeader())}initBroadcastChannel(){if(!(typeof BroadcastChannel>"u"))try{this.bc=new BroadcastChannel("agent-monitor-sse"),this.bc.onmessage=t=>this.onBCMessage(t.data),window.addEventListener("beforeunload",()=>{var t;this.isLeader&&((t=this.bc)==null||t.postMessage({kind:"leader_gone"}))})}catch{this.bc=null}}onBCMessage(t){var s;switch(t.kind){case"leader_here":this.followerWait&&(clearTimeout(this.followerWait),this.followerWait=null);break;case"leader_heartbeat":this.followerWait&&clearTimeout(this.followerWait),this.followerWait=setTimeout(()=>this.becomeLeader(),5e3);break;case"leader_gone":case"whois_leader":this.isLeader&&((s=this.bc)==null||s.postMessage({kind:"leader_here"})),t.kind==="leader_gone"&&!this.isLeader&&(this.followerWait&&clearTimeout(this.followerWait),this.followerWait=setTimeout(()=>this.becomeLeader(),200));break;case"relay_event":t.event&&this.dispatch(t.event);break}}becomeLeader(){var t;this.isLeader||(this.isLeader=!0,(t=this.bc)==null||t.postMessage({kind:"leader_here"}),this.leaderHeartbeat=setInterval(()=>{var s;(s=this.bc)==null||s.postMessage({kind:"leader_heartbeat"})},3e3),this.openEventSource())}openEventSource(){this.es&&this.es.close(),E.set("connecting");const t=ee+ge;try{this.es=new EventSource(t,{withCredentials:!0})}catch{E.set("disconnected"),this.dispatch({type:"agent_error",error:"EventSource unsupported",__auth:!0});return}this.es.onopen=()=>{this.closeRetries=0,E.set("connected"),this.resetDeadTimer()},this.es.onmessage=s=>{var o;this.resetDeadTimer();try{const n=JSON.parse(s.data);this.dispatch(n),(o=this.bc)==null||o.postMessage({kind:"relay_event",event:n})}catch{}},this.es.onerror=()=>{var s;if(((s=this.es)==null?void 0:s.readyState)===2){if(this.clearDeadTimer(),this.closeRetries=(this.closeRetries||0)+1,this.closeRetries>=3){E.set("disconnected"),this.dispatch({type:"agent_error",error:"sse_closed",__auth:!0});return}E.set("connecting"),setTimeout(()=>this.openEventSource(),1500);return}E.set("connecting"),this.resetDeadTimer()},this.resetDeadTimer()}resetDeadTimer(){this.deadTimer&&clearTimeout(this.deadTimer),this.deadTimer=setTimeout(()=>{this.es&&this.es.close(),this.openEventSource()},We)}clearDeadTimer(){this.deadTimer&&clearTimeout(this.deadTimer),this.deadTimer=null}dispatch(t){for(const s of this.handlers)try{s(t)}catch{}}on(t){this.handlers.add(t)}off(t){this.handlers.delete(t)}close(){if(this.disposed=!0,this.clearDeadTimer(),this.leaderHeartbeat&&clearInterval(this.leaderHeartbeat),this.followerWait&&clearTimeout(this.followerWait),this.es&&this.es.close(),this.es=null,this.isLeader&&this.bc&&this.bc.postMessage({kind:"leader_gone"}),this.bc)try{this.bc.close()}catch{}this.bc=null,E.set("disconnected")}}function p(e){return e==null||e===!1?"":String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function $(e,t){return e?e.length>t?e.slice(0,t)+"...":e:"-"}function Fe(e){return e?new Date(e).toLocaleTimeString("en-US",{hour12:!1}):""}async function Re(){return g("/api/hierarchy")}async function qe(e,t=""){await g("/api/workspaces",{method:"POST",body:JSON.stringify({name:e,description:t})})}async function ze(e,t,s=""){await g(`/api/workspaces/${e}/projects`,{method:"POST",body:JSON.stringify({name:t,description:s})})}async function Ve(e,t,s,o="",n=""){await g(`/api/workspaces/${e}/projects/${t}/topics`,{method:"POST",body:JSON.stringify({name:s,description:n,agent_type:o})})}async function Je(e,t,s,o,n=""){await g(`/api/workspaces/${e}/projects/${t}/topics/${s}/stories`,{method:"POST",body:JSON.stringify({name:o,description:n})})}async function Ke(e,t,s=""){await g(`/api/stories/${e}`,{method:"PUT",body:JSON.stringify({name:t,description:s})})}async function Ge(e){await g(`/api/stories/${e}`,{method:"DELETE"})}async function Xe(e,t){return g(`/api/permissions/${e}/${t}`)}async function Ze(e,t,s,o){await g(`/api/permissions/${e}/${t}`,{method:"PUT",body:JSON.stringify({user_id:s,level:o})})}async function Qe(e,t,s){await g(`/api/permissions/${e}/${t}/${s}`,{method:"DELETE"})}async function Ye(){return g("/api/users")}function ae(e,t){const s=document.getElementById("modal-box"),o=document.getElementById("modal-overlay");if(!s||!o)return;const a={workspace:["Workspace Name",""],project:["Project Name",""],topic:["Topic Name","agent_type (optional)"]}[e];s.innerHTML=`
    <h3>New ${p(e)}</h3>
    <label class="field-label" for="modal-name">${p(a[0])}</label>
    <input type="text" id="modal-name" placeholder="${p(a[0])}" autofocus>
    ${e==="topic"?'<label class="field-label" for="modal-agent">Agent type</label><input type="text" id="modal-agent" placeholder="claude / codex / opencode">':""}
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Create</button>
    </div>`,o.style.display="flex",P("modal-cancel"),D("modal-name",()=>J(e,t));const i=document.getElementById("modal-create");i&&(i.onclick=()=>J(e,t))}function ie(e,t){const s=document.getElementById("modal-box"),o=document.getElementById("modal-overlay");if(!s||!o)return;s.innerHTML=`
    <h3>Rename Story</h3>
    <label class="field-label" for="modal-name">New name</label>
    <input type="text" id="modal-name" value="${p(t)}" autofocus>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Save</button>
    </div>`,o.style.display="flex",P("modal-cancel");const n=async()=>{var l;const i=((l=document.getElementById("modal-name"))==null?void 0:l.value.trim())??"";if(!i){v.warn("Name is required");return}const c=document.getElementById("modal-create");c&&(c.disabled=!0,c.textContent="Saving…");try{await Ke(e,i),I(),await x(),v.ok("Story renamed")}catch(h){v.error("Rename failed: "+(h.message||"unknown"))}finally{c&&(c.disabled=!1,c.textContent="Save")}};D("modal-name",n);const a=document.getElementById("modal-create");a&&(a.onclick=n)}function re(e,t){const s=document.getElementById("modal-box"),o=document.getElementById("modal-overlay");if(!s||!o)return;s.innerHTML=`
    <h3>Delete story?</h3>
    <p>“${p(t)}” will be removed permanently.</p>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-danger" id="modal-delete">Delete</button>
    </div>`,o.style.display="flex",P("modal-cancel");const n=document.getElementById("modal-delete");n&&(n.onclick=()=>U(e))}function P(e){const t=document.getElementById(e);t&&(t.onclick=()=>I())}function D(e,t){const s=document.getElementById(e);s&&(s.onkeydown=o=>{o.key==="Enter"&&t()})}function I(){const e=document.getElementById("modal-overlay");e&&(e.style.display="none")}async function J(e,t){var a,i;const s=((a=document.getElementById("modal-name"))==null?void 0:a.value.trim())??"";if(!s){v.warn("Name is required");return}const o=document.getElementById("modal-create");o&&(o.disabled=!0,o.textContent="Creating…");const n=d.selectedWorkspaceId??1;try{switch(e){case"workspace":await qe(s);break;case"project":await ze(n,s);break;case"topic":{const c=((i=document.getElementById("modal-agent"))==null?void 0:i.value.trim())??"";await Ve(n,t,s,c);break}}I(),await x(),v.ok(`${e} created`)}catch(c){v.error("Create failed: "+(c.message||"unknown"))}}async function ce(e){et(e)}function et(e){const t=document.getElementById("modal-box"),s=document.getElementById("modal-overlay");if(!t||!s)return;t.innerHTML=`
    <h3>New Story under Topic ${e}</h3>
    <label class="field-label" for="modal-name">Story name</label>
    <input type="text" id="modal-name" autofocus>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Create</button>
    </div>`,s.style.display="flex",P("modal-cancel"),D("modal-name",()=>K(e));const o=document.getElementById("modal-create");o&&(o.onclick=()=>K(e))}async function K(e){var n,a,i;const t=((n=document.getElementById("modal-name"))==null?void 0:n.value.trim())??"";if(!t){v.warn("Name is required");return}const s=d.selectedWorkspaceId??1;let o=0;for(const c of((a=d.tree)==null?void 0:a.workspaces)??[])for(const l of c.projects??[])if((i=l.topics)!=null&&i.some(h=>h.topic.id===e)){o=l.project.id;break}if(!o){v.error("Topic not found — refresh and try again");return}try{await Je(s,o,e,t),I(),await x(),v.ok("Story created")}catch(c){v.error("Create story failed: "+(c.message||"unknown"))}}async function de(e){var s,o;let t="";for(const n of((s=d.tree)==null?void 0:s.workspaces)??[])for(const a of n.projects??[])for(const i of a.topics??[]){const c=(o=i.stories)==null?void 0:o.find(l=>l.id===e);if(c){t=c.name;break}}ie(e,t)}async function U(e){var o,n;let t="";for(const a of((o=d.tree)==null?void 0:o.workspaces)??[])for(const i of a.projects??[])for(const c of i.topics??[]){const l=(n=c.stories)==null?void 0:n.find(h=>h.id===e);if(l){t=l.name;break}}re(e,t);const s=document.getElementById("modal-delete");s&&(s.onclick=async()=>{try{await Ge(e),I(),await x(),v.ok("Story deleted")}catch(a){v.error("Delete failed: "+(a.message||"unknown"))}})}async function x(){try{const e=await Re();d.setTree(e)}catch(e){v.error("Hierarchy refresh failed: "+(e.message||"unknown"))}}function le(e,t){const s={workspace:"Workspace",project:"Project"},o=document.getElementById("modal-box"),n=document.getElementById("modal-overlay");if(!o||!n)return;o.innerHTML=`
    <h3>${s[e]} Permissions</h3>
    <div id="perm-list" class="perm-list">Loading…</div>
    <div class="perm-add-row">
      <select id="perm-user-select" aria-label="User"></select>
      <select id="perm-level-select" aria-label="Level">
        <option value="100">Admin</option>
        <option value="10">Viewer</option>
      </select>
      <button class="btn-primary" id="perm-add">Add</button>
    </div>
    <div class="modal-actions"><button class="btn-cancel" id="perm-close">Close</button></div>`,n.style.display="flex",P("perm-close");const a=document.getElementById("perm-add");a&&(a.onclick=()=>st(e,t)),F(e,t),tt()}async function F(e,t){const s=document.getElementById("perm-list");if(s)try{const o=await Xe(e,t);if(o.length===0){s.innerHTML='<div class="perm-empty">No permissions set</div>';return}s.innerHTML=o.map(n=>`
      <div class="perm-row" data-perm-uid="${n.user_id}">
        <span class="perm-user">User #${n.user_id}<span class="perm-level"> (${n.level>=100?"Admin":"Viewer"})</span></span>
        <button class="perm-remove" data-uid="${n.user_id}" aria-label="Revoke">✕</button>
      </div>`).join(""),s.querySelectorAll("[data-uid]").forEach(n=>{n.onclick=async()=>{const a=parseInt(n.dataset.uid??"0",10);try{await Qe(e,t,a),v.ok("Permission revoked"),F(e,t)}catch(i){v.error("Revoke failed: "+(i.message||"unknown"))}}})}catch{s.innerHTML='<div class="perm-empty">Failed to load</div>'}}async function tt(){try{const e=await Ye(),t=document.getElementById("perm-user-select");if(!t)return;t.innerHTML=e.map(s=>`<option value="${s.id}">${p(s.username)}</option>`).join("")}catch{}}async function st(e,t){var n,a;const s=parseInt(((n=document.getElementById("perm-user-select"))==null?void 0:n.value)??"0"),o=parseInt(((a=document.getElementById("perm-level-select"))==null?void 0:a.value)??"0");if(s)try{await Ze(e,t,s,o),v.ok("Permission added"),F(e,t)}catch(i){v.error("Add permission failed: "+(i.message||"unknown"))}}const A=Object.freeze(Object.defineProperty({__proto__:null,closeModal:I,onCreateStory:ce,onDeleteStory:U,onEditStory:de,refreshHierarchy:x,showCreateModal:ae,showDeleteStoryModal:re,showEditStoryModal:ie,showPermissionModal:le},Symbol.toStringTag,{value:"Module"}));function nt(){const e=d.tree,t=document.getElementById("sidebar-tree");if(!t||!e||!e.workspaces)return;const s=e.workspaces.find(n=>n.workspace.id===d.selectedWorkspaceId);if(!s){t.innerHTML="";return}let o="";if(s.projects)for(const n of s.projects)o+=at(n);o+='<div class="tree-separator"></div>',t.innerHTML=o}function ot(){const e=document.getElementById("sidebar-tree");e&&rt(e)}function at(e){const t="proj_"+e.project.id,s=d.expandedNodes[t]!==!1,o=(e.topics||[]).length;let n=`<div class="tree-node tree-project" data-action="toggle-proj" data-id="${t}">
    <span class="arrow${s?" open":""}">▸</span>
    <span class="node-icon">&#9632;</span>
    <span class="label">${p(e.project.name)}</span>
    ${o>0?`<span class="count">${o}</span>`:""}
    <span class="add-child" data-action="create-topic" data-id="${e.project.id}">+</span>
    <span class="add-child" data-action="show-perm-project" data-id="${e.project.id}">👥</span>
  </div>`;if(n+=`<div class="tree-children${s?" open":""}" id="${t}">`,e.topics)for(const a of e.topics)n+=it(a);return n+="</div>",n}function it(e){var i;const t="topic_"+e.topic.id,s=d.expandedNodes[t]!==!1,o=d.selectedTopicId===e.topic.id?" selected":"",n=((i=e.stories)==null?void 0:i.length)??0;let a=`<div class="tree-node tree-topic${o}" data-action="select-topic" data-id="${e.topic.id}">
    <span class="arrow${s?" open":""}" data-action="toggle-node" data-id="${t}">▸</span>
    <span class="node-icon">&#9679;</span>
    <span class="label">${p(e.topic.name)}</span>
    ${n>0?`<span class="count">${n}</span>`:""}
    <span class="add-child" data-action="create-story" data-id="${e.topic.id}">+</span>
  </div>`;if(e.stories&&e.stories.length>0){a+=`<div class="tree-children${s?" open":""}" id="${t}">`;for(const c of e.stories){const l=c.session_key,h=d.selectedStoryId===c.id?" selected":"",u=l?y.sessions[l]:null,r=c.name,f=u?u.session_title||$(u.agent_session_id,20):"";a+=`<div class="tree-node tree-story${h}" data-action="select-story" data-id="${c.id}">
        <span class="node-icon">&#8728;</span>
        <span class="label" title="${p(f)}">${p($(r,28))}</span>
        <span class="add-child" data-action="edit-story" data-id="${c.id}">✎</span>
        <span class="add-child" data-action="delete-story" data-id="${c.id}">✕</span>
      </div>`}a+="</div>"}return a}function rt(e){e.addEventListener("click",t=>{const o=t.target.closest("[data-action]");if(!o)return;const n=o.dataset.action,a=o.dataset.id??"";switch(n){case"toggle-proj":d.toggleNode(a);break;case"toggle-node":t.stopPropagation(),d.toggleNode(a);break;case"select-topic":d.selectTopic(parseInt(a,10),"");break;case"select-story":d.selectStory(parseInt(a,10));break;case"show-perm-project":t.stopPropagation(),le("project",parseInt(a,10));break;case"create-topic":t.stopPropagation(),ae("topic",parseInt(a,10));break;case"create-story":t.stopPropagation(),ce(parseInt(a,10));break;case"edit-story":t.stopPropagation(),de(parseInt(a,10));break;case"delete-story":t.stopPropagation(),U(parseInt(a,10));break}})}async function ct(e,t,s,o=10){return g(`/api/agent/${e}/sessions/${encodeURIComponent(t)}/prompt`,{method:"POST",body:JSON.stringify({prompt:s,session_id:t,timeout_minutes:o})})}async function dt(e,t,s){const o=s?`?exec_id=${encodeURIComponent(s)}`:"";await g(`/api/agent/${e}/sessions/${encodeURIComponent(t)}/cancel${o}`,{method:"POST"})}async function lt(e,t){await g(`/api/sessions/${encodeURIComponent(e)}/input`,{method:"POST",body:JSON.stringify({text:t})})}function ut(e,t){if(!(e!=null&&e.length))return"";let s='<div class="timeline">';return[...e].reverse().forEach((o,n)=>{const a=o.turn_idx,i=`${t}_turn_${a}`,c=n===0;i in y.expandedTurns||(y.expandedTurns[i]=c);const l=y.expandedTurns[i];s+=`<div class="turn-block">
      <div class="turn-header" data-action="toggle-turn" data-key="${p(t)}" data-ti="${a}">
        <span>Turn ${(o.turn_idx??0)+1} · ${p(Fe(o.user_ts||0))}</span>
        <span style="font-size:0.7em;color:var(--text-disabled)">${l?"▼":"▶"}</span>
      </div>
      <div class="turn-body${l?" open":""}">`,o.user_input&&(s+=`<div class="user-input-block">${p(o.user_input)}</div>`);const h=[];for(const r of o.entries||[])if(r.tools&&r.tools.length>0)for(const f of r.tools)h.push(f);let u=0;for(const r of h){const f=`${t}_${a}_tc_${u++}`,k=y.expandedToolGroups[f];s+=`<div class="tool-group">
        <div class="tool-header" data-action="toggle-tool" data-id="${f}">
          <span class="tool-name">${p(r.name)}</span>
          <span class="tool-status ${p(r.status)}">${r.status==="running"?'<span class="pulse"></span>':""}${p(r.status)}</span>
          <span style="margin-left:auto;color:var(--text-disabled);font-size:0.8em">${r.end_ts?r.end_ts-r.start_ts+"ms":"…"}</span>
        </div>
        <div class="tool-detail${k?" open":""}">${p(r.output||r.input||"")}</div>
      </div>`}s+="</div></div>"}),s+="</div>",s}function pt(){const e=document.getElementById("session-detail-panel");e&&e.addEventListener("click",t=>{const o=t.target.closest("[data-action]");if(!o)return;const n=o.dataset.action,a=o.dataset.key??"",i=parseInt(o.dataset.ti??"0",10);switch(n){case"toggle-turn":t.stopPropagation(),y.toggleTurn(a,i);break;case"toggle-tool":t.stopPropagation();const c=o.dataset.id??"";y.toggleToolDetail(c);break}})}function G(){const e=document.getElementById("session-list-body");if(!e)return;let t=null,s=null;if(d.selectedStoryId&&d.tree){if(s=vt(d.selectedStoryId),!s){e.innerHTML='<div class="empty-state"><h3>No sessions linked</h3><p>This story is not yet linked to a session.</p></div>';return}}else d.selectedTopicId&&d.tree&&(t=yt(d.selectedTopicId));const o=y.filteredList(t,s);if(o.length===0){e.innerHTML='<div class="empty-state"><h3>No sessions</h3><p>Select a topic on the left or wait for agent events.</p></div>';return}e.innerHTML=o.map(n=>mt(n)).join(""),e.querySelectorAll(".session-row").forEach(n=>{n.addEventListener("click",()=>{e.querySelectorAll(".session-row").forEach(i=>i.classList.remove("selected")),n.classList.add("selected");const a=n.dataset.key||"";y.selectedSessionKey=a,ue()})})}function mt(e){const t=p(e.session_key),s=y.selectedSessionKey===e.session_key?" selected":"",o=e.session_title||e.agent_session_id||t,n=[$(e.agent_session_id,20),e.terminal||"-",e.memory_mb?`${e.memory_mb.toFixed(0)}MB`:""].filter(Boolean).join(" · ");return`<div class="session-row${s}" data-key="${t}">
    <span class="row-status ${e.status}"></span>
    <span class="agent-badge ${e.agent_type}">${p(e.agent_type)}</span>
    <span class="row-info">
      <span class="row-title">${p(o)}</span>
      <span class="row-sub">${p(n)}</span>
    </span>
    <span class="row-meta">
      <span>T${e.turn_count||0}</span>
      <span class="cpu" style="color:${e.cpu_percent?"var(--accent)":"var(--text-tertiary)"}">${e.cpu_percent?e.cpu_percent.toFixed(0)+"%":"—"}</span>
    </span>
  </div>`}function ue(){const e=document.getElementById("session-detail-panel");if(!e)return;if(!y.selectedSessionKey){e.innerHTML='<div class="empty-state" id="detail-empty"><h3>Select a session</h3><p>Choose a session from the list to view its timeline and details.</p></div>';return}const t=y.sessions[y.selectedSessionKey];if(!t){e.innerHTML='<div class="empty-state"><h3>Session not found</h3></div>';return}const s=e.scrollTop,o="detail-input-"+p(t.session_key),n=document.getElementById(o),a=n?n.value:y.draftInputs[t.session_key]||"",i=t.session_title||t.agent_session_id,c=t.turns&&t.turns.length>0,l=t.status==="error"||t.status==="disappeared"||t.status==="unknown",h="";e.innerHTML=`<div class="session-detail-content">
    <div class="detail-header">
      <span class="agent-badge ${t.agent_type}">${p(t.agent_type)}</span>
      <span class="detail-title">${p(i)}</span>
      <span class="status-badge ${t.status}">${t.status}</span>
      <div class="detail-actions">${h}</div>
    </div>
    ${l?ft(t):""}
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Session</div><div class="info-value">${p($(t.agent_session_id,16))}</div></div>
      <div class="info-item"><div class="info-label">PID</div><div class="info-value">${t.pid||"—"}</div></div>
      <div class="info-item"><div class="info-label">Terminal</div><div class="info-value">${p(t.terminal||"—")}</div></div>
      <div class="info-item"><div class="info-label">CWD</div><div class="info-value">${p($(t.cwd||"",36))}</div></div>
      <div class="info-item"><div class="info-label">Turns</div><div class="info-value">${t.turn_count||0}</div></div>
      <div class="info-item"><div class="info-label">CPU / Memory</div><div class="info-value">${t.cpu_percent?t.cpu_percent.toFixed(0)+"%":"—"} · ${t.memory_mb?t.memory_mb.toFixed(0)+" MB":"—"}</div></div>
    </div>
    ${t.agent_output?ht(String(t.agent_output)):""}
    ${c?'<div class="detail-section-title">Timeline</div>'+ut(t.turns,t.session_key):""}
    <div class="session-input-row">
      <input type="text" id="detail-input-${p(t.session_key)}" placeholder="Send input to this session...">
      <button class="btn btn-primary" data-send="${p(t.session_key)}">Send</button>
    </div>
  </div>`;const u=e.querySelector(`[data-send="${p(t.session_key)}"]`);u&&u.addEventListener("click",()=>X(t.session_key));const r=e.querySelector("input");r&&(r.onkeydown=k=>{k.key==="Enter"&&X(t.session_key)});const f=document.getElementById(o);f&&a&&(f.value=a),e.scrollTop=s}function ft(e){return`<div class="error-alert">
    <div class="error-alert-title">${e.status==="error"?"Error":"Process disconnected"}</div>
    <div class="error-alert-detail">${p(e.agent_output||"No additional details.")}</div>
  </div>`}function ht(e){return`<div class="detail-section-title">Output</div>
    <div class="output-block">${p(e)}</div>`}async function X(e){const t=document.getElementById("detail-input-"+e);if(!t)return;const s=t.value.trim();if(s)try{await lt(e,s),t.value="",v.ok("Sent")}catch{v.error("Send failed")}}function vt(e){var t;for(const s of((t=d.tree)==null?void 0:t.workspaces)??[])for(const o of s.projects??[])for(const n of o.topics??[])for(const a of n.stories??[])if(a.id===e)return a.session_key||null;return null}function yt(e){var s;const t=new Set;for(const o of((s=d.tree)==null?void 0:s.workspaces)??[])for(const n of o.projects??[])for(const a of n.topics??[])if(a.topic.id===e)for(const i of a.stories??[])i.session_key&&t.add(i.session_key);return t}function gt(){const e=document.getElementById("agent-panel");if(!e)return;e.className="agent-panel",e.innerHTML=`
    <div class="agent-panel-header" id="agent-panel-header">
      <span>Agent Control</span>
      <span class="agent-panel-arrow" id="agent-panel-arrow">▼</span>
    </div>
    <div class="agent-panel-body" id="agent-panel-body">
      <div class="agent-panel-row">
        <select id="agent-select" aria-label="Agent type">
          <option value="claude">Claude Code</option>
          <option value="opencode">OpenCode</option>
          <option value="codex">Codex</option>
        </select>
        <input id="agent-session-id" type="text" placeholder="Session ID (optional)">
        <select id="agent-timeout" aria-label="Timeout">
          <option value="5">5m</option>
          <option value="10" selected>10m</option>
          <option value="30">30m</option>
          <option value="60">1h</option>
          <option value="120">2h</option>
        </select>
      </div>
      <textarea id="agent-prompt" class="agent-prompt" rows="2" placeholder="Enter prompt…"></textarea>
      <div class="agent-actions">
        <button id="agent-send" class="btn-send">Send</button>
        <button id="agent-cancel" class="btn-cancel">Cancel</button>
        <span id="agent-status" class="agent-status"></span>
      </div>
      <div id="agent-output" class="agent-output"></div>
    </div>`;const t=document.getElementById("agent-panel-header"),s=document.getElementById("agent-panel-body"),o=document.getElementById("agent-panel-arrow");t&&s&&o&&(t.onclick=()=>{const i=s.classList.toggle("open");o.classList.toggle("open",i)});const n=document.getElementById("agent-send");n&&(n.onclick=bt);const a=document.getElementById("agent-cancel");a&&(a.onclick=wt)}async function bt(){var i,c,l;const e=((i=document.getElementById("agent-select"))==null?void 0:i.value)??"claude",t=((c=document.getElementById("agent-session-id"))==null?void 0:c.value.trim())??"",s=document.getElementById("agent-prompt"),o=(s==null?void 0:s.value.trim())??"",n=parseInt(((l=document.getElementById("agent-timeout"))==null?void 0:l.value)??"10")||10;if(!o){v.warn("Prompt is empty");return}const a=document.getElementById("agent-status");a&&(a.textContent="Running…");try{const h=await ct(e,t,o,n);s&&(s.value="");const u=document.getElementById("agent-session-id");u&&!t&&(u.value=h.session_id),_.setCurrent(h.exec_id),v.ok("Execution started")}catch(h){a&&(a.textContent="Error"),v.error("Send failed: "+(h.message||"unknown"))}}async function wt(){var o,n;const e=((o=document.getElementById("agent-select"))==null?void 0:o.value)??"claude",t=((n=document.getElementById("agent-session-id"))==null?void 0:n.value.trim())??"",s=document.getElementById("agent-status");s&&(s.textContent="Cancelling…");try{await dt(e,t,_.currentExecId??void 0),v.info("Cancelled")}catch(a){s&&(s.textContent="Error"),v.error("Cancel failed: "+(a.message||"unknown"))}}function kt(){const e=document.getElementById("agent-output");if(!e)return;if(_.executions.length===0){e.classList.remove("is-open"),e.innerHTML="";return}e.classList.add("is-open");const t=_.executions.find(o=>o.id===_.currentExecId),s=document.getElementById("agent-status");if(t&&s){const o={completed:"Completed",error:"Error",cancelled:"Cancelled",running:"Running…"};s.textContent=o[t.status]||t.status}if(t){e.innerHTML=Et(t);const o=e.querySelector('[data-action="exec-back"]');o&&(o.onclick=()=>{_.setCurrent(null)})}else e.innerHTML=_.executions.map(o=>`<div class="exec-row" data-exec="${p(o.id)}">${_t(o.status)} <b>${p(o.agent_type??"")}</b> <span class="exec-preview">${p((o.prompt??"").slice(0,60))}</span></div>`).join(""),e.querySelectorAll("[data-exec]").forEach(o=>{o.onclick=()=>{_.setCurrent(o.dataset.exec??null)}})}function Et(e){let t='<div class="exec-back" data-action="exec-back">← Back to history</div>';t+=`<div class="exec-prompt-label">Prompt: ${p(e.prompt??"")}</div>`;for(const s of e.messages)s.msg_type==="tool_use"||s.type==="tool_use"?t+=`<div class="msg-tool">[${p(s.tool_name??"tool")}] ${p(s.tool_input??"")}</div>`:s.content&&(t+=`<div class="msg-text">${p(s.content)}</div>`);return e.status==="error"&&e.error&&(t+=`<div class="msg-error">[ERROR] ${p(e.error)}</div>`),t}function _t(e){switch(e){case"running":return'<span class="exec-spin"></span>';case"completed":return'<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--success-text)" stroke-width="1.5"/><path d="M5 8l2 2 4-4" fill="none" stroke="var(--success-text)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';case"error":return'<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--danger-text)" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="var(--danger-text)" stroke-width="1.5" stroke-linecap="round"/></svg>';default:return'<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="var(--text-muted)" stroke-width="1.5"/></svg>'}}let b=null;function It(e){if(e.type==="agent_error"&&e.__auth){b&&(b.close(),b=null),w.clear(),j(async()=>{const{renderAuth:t}=await Promise.resolve().then(()=>Pe);return{renderAuth:t}},void 0).then(({renderAuth:t})=>t("login")),v.warn("Session expired — please sign in again");return}d.applyEvent(e),y.applyEvent(e),_.applyEvent(e)}function pe(){b&&b.close(),b=new Ue,b.on(It),b.connect()}let me="sessions";function xt(){const e=document.getElementById("app");if(!e)return;e.innerHTML=`
    <!-- Top Navigation -->
    <nav class="top-nav">
      <div class="logo">
        <span class="dot"></span> Infinity
      </div>

      <div class="ws-switcher" id="ws-switcher">
        <button class="ws-btn" id="ws-btn">
          <span class="ws-icon"></span>
          <span id="ws-name">Workspace</span>
          <span class="ws-chevron">▼</span>
        </button>
        <div class="ws-dropdown" id="ws-dropdown">
          <div class="ws-drop-header">Workspaces</div>
          <div id="ws-options"></div>
          <div class="ws-drop-footer">
            <button id="ws-new-btn">+ New Workspace</button>
          </div>
        </div>
      </div>
      <div class="ws-backdrop" id="ws-backdrop"></div>

      <div style="flex:1"></div>

      <div class="nav-info" id="nav-status">
        <span class="status-dot" id="status-dot"></span>
        <span id="nav-addr">daemon 127.0.0.1:9101</span>
        <span class="sep">·</span>
        <span id="nav-active-count">0 active</span>
      </div>

      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">☾</button>

      <div class="user-menu" id="user-menu">
        <button class="user-btn" id="user-btn">
          <span class="avatar" id="user-avatar">U</span>
          <span id="user-name-display">User</span>
          <span class="user-chevron">▼</span>
        </button>
        <div class="user-dropdown" id="user-dropdown">
          <div class="user-info">
            <span class="avatar-lg" id="user-avatar-lg">U</span>
            <div>
              <div class="user-name" id="user-fullname">User</div>
              <div class="user-role"><span class="dot"></span> Admin</div>
            </div>
          </div>
          <button class="menu-item" id="menu-permissions">Permissions</button>
          <button class="menu-item" id="menu-agent-panel">Agent Panel</button>
          <div class="menu-sep"></div>
          <button class="menu-item danger" id="menu-signout">Sign Out</button>
        </div>
        <div class="user-backdrop" id="user-backdrop"></div>
      </div>
    </nav>

    <!-- Main area -->
    <div class="main-area">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-body">
          <div class="side-nav-item active" data-view="sessions" id="nav-sessions">
            <span class="side-nav-icon">&#9776;</span>
            <span class="side-nav-label">Sessions</span>
            <span class="side-nav-badge" id="sess-badge">0</span>
          </div>
          <div class="side-nav-item" data-view="dashboard" id="nav-dashboard">
            <span class="side-nav-icon">&#9632;</span>
            <span class="side-nav-label">Dashboard</span>
          </div>

          <div class="tree-separator"></div>

          <div class="sidebar-header">
            Projects
            <button class="add-btn" id="sidebar-add-project" title="Add Project">+</button>
          </div>
          <div id="sidebar-tree"></div>
        </div>
      </aside>

      <!-- Dashboard View -->
      <div class="view-panel" id="view-dashboard">
        <main class="full-main">
          <div>
            <h1 style="font-size:var(--text-xl);font-weight:700;color:var(--text-primary)">Dashboard</h1>
            <div id="dash-ws-subtitle" style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:4px"></div>
          </div>
          <div class="stats-row" id="stats-row"></div>
          <div class="detail-section-title">Recent Activity</div>
          <div id="recent-activity"></div>
        </main>
      </div>

      <!-- Sessions View -->
      <div class="view-panel active" id="view-sessions">
        <div class="session-list-panel" id="session-list-panel">
          <div class="dash-header">
            <h1>Sessions</h1>
          </div>
          <div class="filter-group" id="filter-group"></div>
          <div class="stats-row" id="session-stats" style="grid-template-columns:repeat(4,1fr);padding:0 var(--space-4)"></div>
          <div class="session-list-header"><span>Session</span><span>T / CPU</span></div>
          <div class="session-list-body" id="session-list-body"></div>
        </div>
        <div class="session-detail-panel" id="session-detail-panel">
          <div class="empty-state" id="detail-empty">
            <h3>Select a session</h3>
            <p>Choose a session from the list to view its timeline and details.</p>
          </div>
        </div>
        <div id="agent-panel" style="display:none"></div>
      </div>
    </div>`;const t=document.createElement("div");t.className="modal-overlay",t.id="modal-overlay",t.style.display="none",t.innerHTML='<div class="modal-box" id="modal-box"></div>',t.onclick=l=>{l.target===t&&I()},document.body.appendChild(t);const s=document.createElement("div");s.id="auth-overlay",s.style.display="none",document.body.prepend(s),Tt(),St(),ot(),pt(),gt();const o=localStorage.getItem("agent-monitor-theme"),n=document.getElementById("theme-toggle");n&&(o==="light"&&(document.documentElement.setAttribute("data-theme","light"),n.innerHTML="&#9788;"),n.onclick=()=>{document.documentElement.getAttribute("data-theme")==="light"?(document.documentElement.removeAttribute("data-theme"),n.innerHTML="&#9790;",localStorage.setItem("agent-monitor-theme","dark")):(document.documentElement.setAttribute("data-theme","light"),n.innerHTML="&#9788;",localStorage.setItem("agent-monitor-theme","light"))});let a=d.selectedWorkspaceId,i=d.selectedTopicId,c=d.selectedStoryId;d.subscribe(()=>{(d.selectedWorkspaceId!==a||d.selectedTopicId!==i||d.selectedStoryId!==c)&&(a=d.selectedWorkspaceId,i=d.selectedTopicId,c=d.selectedStoryId,y.selectedSessionKey=null),nt(),G(),Z(),Y(),H()}),y.subscribe(()=>{G(),ue(),Z(),Y(),H()}),_.subscribe(()=>kt()),E.subscribe(()=>Q(E.current())),Q("disconnected")}function Tt(){const e=document.getElementById("ws-btn"),t=document.getElementById("ws-dropdown"),s=document.getElementById("ws-backdrop");e&&t&&s&&(e.onclick=()=>{t.classList.toggle("open"),s.classList.toggle("open")},s.onclick=()=>{t.classList.remove("open"),s.classList.remove("open")});const o=document.getElementById("user-btn"),n=document.getElementById("user-dropdown"),a=document.getElementById("user-backdrop");o&&n&&a&&(o.onclick=()=>{n.classList.toggle("open"),a.classList.toggle("open")},a.onclick=()=>{n.classList.remove("open"),a.classList.remove("open")});const i=document.getElementById("menu-signout");i&&(i.onclick=()=>{n==null||n.classList.remove("open"),a==null||a.classList.remove("open"),te()});const c=document.getElementById("menu-permissions");c&&(c.onclick=()=>{n==null||n.classList.remove("open"),a==null||a.classList.remove("open");const r=d.selectedWorkspaceId??1;j(async()=>{const{showPermissionModal:f}=await Promise.resolve().then(()=>A);return{showPermissionModal:f}},void 0).then(({showPermissionModal:f})=>f("workspace",r))});const l=document.getElementById("menu-agent-panel");l&&(l.onclick=()=>{n==null||n.classList.remove("open"),a==null||a.classList.remove("open");const r=document.getElementById("agent-panel"),f=document.getElementById("agent-panel-body");if(r){const k=r.style.display==="block";r.style.display=k?"none":"block",f&&f.classList.toggle("open",!k)}});const h=document.getElementById("ws-new-btn");h&&(h.onclick=()=>{t==null||t.classList.remove("open"),s==null||s.classList.remove("open"),j(async()=>{const{showCreateModal:r}=await Promise.resolve().then(()=>A);return{showCreateModal:r}},void 0).then(({showCreateModal:r})=>r("workspace",0))});const u=document.getElementById("sidebar-add-project");u&&(u.onclick=()=>{j(async()=>{const{showCreateModal:r}=await Promise.resolve().then(()=>A);return{showCreateModal:r}},void 0).then(({showCreateModal:r})=>{const f=d.selectedWorkspaceId??1;r("project",f)})})}function St(){document.querySelectorAll(".side-nav-item").forEach(e=>{e.addEventListener("click",()=>{document.querySelectorAll(".side-nav-item").forEach(s=>s.classList.remove("active")),e.classList.add("active");const t=e.dataset.view||"sessions";$t(t)})})}function $t(e){me=e,document.querySelectorAll(".view-panel").forEach(s=>s.classList.remove("active"));const t=document.getElementById("view-"+e);t&&t.classList.add("active"),e==="dashboard"&&H()}function Z(){var h,u;const e=document.getElementById("ws-name");if(e&&d.tree){const r=(h=d.tree.workspaces)==null?void 0:h.find(f=>f.workspace.id===d.selectedWorkspaceId);r&&(e.textContent=r.workspace.name)}const t=document.getElementById("ws-options");t&&((u=d.tree)!=null&&u.workspaces)&&(t.innerHTML=d.tree.workspaces.map(r=>`
      <button class="ws-option${r.workspace.id===d.selectedWorkspaceId?" selected":""}" data-wid="${r.workspace.id}">
        <span class="ws-dot blue"></span> ${W(r.workspace.name)}
        <span class="ws-info">${(r.projects||[]).length}</span>
      </button>`).join(""),t.querySelectorAll(".ws-option").forEach(r=>{r.addEventListener("click",()=>{var k,R;const f=parseInt(r.dataset.wid||"0");d.selectWorkspace(f),(k=document.getElementById("ws-dropdown"))==null||k.classList.remove("open"),(R=document.getElementById("ws-backdrop"))==null||R.classList.remove("open")})}));const s=document.getElementById("user-name-display"),o=document.getElementById("user-fullname"),n=document.getElementById("user-avatar"),a=document.getElementById("user-avatar-lg");if(w.user){const r=w.user.username,f=r.charAt(0).toUpperCase();s&&(s.textContent=r),o&&(o.textContent=r),n&&(n.textContent=f),a&&(a.textContent=f)}const i=Object.values(y.sessions).filter(r=>r.status==="active").length,c=document.getElementById("nav-active-count");c&&(c.textContent=`${i} active`);const l=document.getElementById("sess-badge");l&&(l.textContent=String(Object.keys(y.sessions).length))}function Q(e){const t=document.getElementById("status-dot"),s=document.getElementById("nav-addr");t&&(t.classList.remove("offline"),e==="connected"?t.style.background="":e==="connecting"?t.style.background="var(--warning)":t.classList.add("offline")),s&&(s.textContent=e==="connected"?"daemon 127.0.0.1:9101":"daemon reconnecting…")}function Y(){const e=document.getElementById("filter-group");if(!e)return;const t=y.statusCounts(),s=Object.values(y.sessions).length,o=["all",...oe].map(n=>{const a=n==="all"?s:t[n]??0;return n!=="all"&&a===0&&y.currentFilter!==n?"":`<button class="filter-pill ${y.currentFilter===n?"active":""}" data-filter="${n}">
      ${n==="all"?"All":n}<span class="count">${a}</span>
    </button>`}).join("");e.innerHTML=o,e.querySelectorAll("[data-filter]").forEach(n=>{n.addEventListener("click",()=>{const a=n.dataset.filter;e.querySelectorAll(".filter-pill").forEach(i=>i.classList.remove("active")),n.classList.add("active"),y.setFilter(a)})})}function H(){var l,h;if(me!=="dashboard")return;const e=document.getElementById("stats-row");if(!e)return;const t=Object.values(y.sessions),s=t.filter(u=>u.status==="active").length,o=t.reduce((u,r)=>u+(r.turn_count||0),0),n=((h=(l=d.tree)==null?void 0:l.workspaces)==null?void 0:h.reduce((u,r)=>{var f;return u+(((f=r.projects)==null?void 0:f.length)||0)},0))??0,a=t.filter(u=>u.cpu_percent).reduce((u,r)=>u+(r.cpu_percent||0),0)/Math.max(1,t.filter(u=>u.cpu_percent).length);e.innerHTML=`
    <div class="stat-card"><div class="stat-label">Active Sessions</div><div class="stat-value">${s}</div></div>
    <div class="stat-card"><div class="stat-label">Total Turns</div><div class="stat-value">${o}</div></div>
    <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value">${n}</div></div>
    <div class="stat-card"><div class="stat-label">Avg CPU</div><div class="stat-value">${a.toFixed(1)}%</div></div>`;const i=document.getElementById("recent-activity");if(!i)return;const c=[...t].sort((u,r)=>r.last_event_time_ms-u.last_event_time_ms).slice(0,6);if(c.length===0){i.innerHTML='<div class="empty-state"><p>No recent activity</p></div>';return}i.innerHTML=c.map(u=>{const r=u.status==="active"?"var(--success)":u.status==="idle"?"var(--warning)":u.status==="stopped"?"var(--text-disabled)":"var(--danger)",f=u.status==="active"?"box-shadow:0 0 6px var(--success-glow)":"";return`<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);background:var(--bg-raised);border:1px solid var(--border-hairline);border-radius:var(--radius-md);margin-bottom:var(--space-2)">
      <span style="width:8px;height:8px;border-radius:50%;background:${r};flex-shrink:0;${f}"></span>
      <span style="font-size:var(--text-sm);color:var(--text-primary);flex:1"><strong>${W(u.agent_type)}</strong> · ${W(u.session_title||u.agent_session_id)}${u.turn_count?" — Turn "+u.turn_count:""}</span>
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);font-family:var(--font-mono)">${Bt(u.last_event_time_ms)}</span>
    </div>`}).join("")}function W(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Bt(e){if(!e)return"";const t=Date.now()-e;return t<0?"":t<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?`${Math.floor(t/36e5)}h ago`:`${Math.floor(t/864e5)}d ago`}w.subscribe(()=>{w.authed&&!b?(pe(),x()):!w.authed&&b&&(b.close(),b=null)});xt();ne();se(()=>{w.authed&&(C(),pe(),x())});
