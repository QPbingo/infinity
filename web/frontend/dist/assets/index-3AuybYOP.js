var ge=Object.defineProperty;var be=(e,t,s)=>t in e?ge(e,t,{enumerable:!0,configurable:!0,writable:!0,value:s}):e[t]=s;var f=(e,t,s)=>be(e,typeof t!="symbol"?t+"":t,s);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))n(o);new MutationObserver(o=>{for(const a of o)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&n(i)}).observe(document,{childList:!0,subtree:!0});function s(o){const a={};return o.integrity&&(a.integrity=o.integrity),o.referrerPolicy&&(a.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?a.credentials="include":o.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function n(o){if(o.ep)return;o.ep=!0;const a=s(o);fetch(o.href,a)}})();const we="modulepreload",ke=function(e){return"/"+e},J={},M=function(t,s,n){let o=Promise.resolve();if(s&&s.length>0){document.getElementsByTagName("link");const i=document.querySelector("meta[property=csp-nonce]"),c=(i==null?void 0:i.nonce)||(i==null?void 0:i.getAttribute("nonce"));o=Promise.allSettled(s.map(l=>{if(l=ke(l),l in J)return;J[l]=!0;const m=l.endsWith(".css"),d=m?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${l}"]${d}`))return;const r=document.createElement("link");if(r.rel=m?"stylesheet":we,m||(r.as="script"),r.crossOrigin="",r.href=l,c&&r.setAttribute("nonce",c),document.head.appendChild(r),m)return new Promise((h,b)=>{r.addEventListener("load",h),r.addEventListener("error",()=>b(new Error(`Unable to preload CSS for ${l}`)))})}))}function a(i){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=i,window.dispatchEvent(c),!c.defaultPrevented)throw i}return o.then(i=>{for(const c of i||[])c.status==="rejected"&&a(c.reason);return t().catch(a)})},te="",Ee="/api/events/stream",z=Ie();let _e=1;const x=[];function Ie(){if(typeof document>"u")return null;let e=document.getElementById("toast-container");return e||(e=document.createElement("div"),e.id="toast-container",e.setAttribute("role","status"),e.setAttribute("aria-live","polite"),document.body.appendChild(e),e)}function j(e,t,s=5e3){if(!z)return;const n=_e++,o=document.createElement("div");o.className=`toast ${e}`,o.innerHTML='<span class="toast-msg"></span><button class="toast-close" aria-label="Dismiss">×</button>',o.querySelector(".toast-msg").textContent=t,o.querySelector(".toast-close").onclick=()=>A(n),z.appendChild(o);let a=null;if(s>0&&(a=setTimeout(()=>A(n),s)),x.push({id:n,el:o,timer:a}),x.length>5){const i=x.shift();i&&(i.timer&&clearTimeout(i.timer),i.el.remove())}}function A(e){const t=x.findIndex(n=>n.id===e);if(t<0)return;const s=x[t];x.splice(t,1),s.timer&&clearTimeout(s.timer),s.el.style.opacity="0",s.el.style.transform="translateX(12px)",setTimeout(()=>s.el.remove(),200)}const v={ok:e=>j("ok",e,4e3),info:e=>j("info",e,5e3),warn:e=>j("warn",e,0),error:e=>j("error",e,0),dismiss:A};class K extends Error{constructor(t,s){super(s),this.status=t,this.name="HTTPError"}}const N="auth:unauthorized";function $e(e){const t=()=>e();return window.addEventListener(N,t),()=>window.removeEventListener(N,t)}function xe(){window.dispatchEvent(new CustomEvent(N))}async function g(e,t={}){var n;let s;try{s=await fetch(te+e,{credentials:"include",headers:{"Content-Type":"application/json",...t.headers??{}},...t})}catch(o){throw v.error("Network error — is the daemon running on :9101?"),o}if(s.status!==204){if(s.status===401)throw xe(),new K(401,"Session expired");if(!s.ok){let o=`HTTP ${s.status}`;try{const a=await s.json();a!=null&&a.error&&(o=a.error)}catch{}throw new K(s.status,o)}if((n=s.headers.get("content-type"))!=null&&n.includes("application/json"))return await s.json()}}async function Se(e,t){return(await g("/api/auth/register",{method:"POST",body:JSON.stringify({username:e,password:t})})).user}async function Te(e,t){return(await g("/api/auth/login",{method:"POST",body:JSON.stringify({username:e,password:t})})).user}async function Be(){await g("/api/auth/logout",{method:"POST"})}async function Le(){try{const e=await g("/api/auth/me",{method:"GET"});return(e==null?void 0:e.user)??null}catch{return null}}class B{constructor(){f(this,"listeners",new Set)}subscribe(t){return this.listeners.add(t),()=>this.listeners.delete(t)}notify(){for(const t of this.listeners)try{t()}catch{}}}class Ce extends B{constructor(){super(...arguments);f(this,"user",null);f(this,"authed",!1)}setUser(s){this.user=s,this.authed=s!==null,this.notify()}clear(){this.user=null,this.authed=!1,this.notify()}}const k=new Ce;function L(e="login"){const t=document.getElementById("auth-overlay"),s=document.getElementById("app");!t||!s||(s.classList.remove("is-ready"),t.style.display="flex",t.innerHTML=Pe(e),je(e))}function Pe(e){const t=e==="login";return`<div class="auth-box">
    <h2>${t?"Sign In":"Create Account"}</h2>
    <div class="error" id="auth-error" style="display:none"></div>
    <input type="text" id="auth-username" placeholder="Username" autocomplete="username" autofocus>
    <input type="password" id="auth-password" placeholder="Password" autocomplete="${t?"current-password":"new-password"}">
    ${t?"":'<input type="password" id="auth-password2" placeholder="Confirm password" autocomplete="new-password">'}
    <button id="auth-submit">${t?"Sign In":"Create Account"}</button>
    <div class="switch">
      ${t?`Don't have an account? <a id="auth-toggle">Sign up</a>`:'Already have an account? <a id="auth-toggle">Sign in</a>'}
    </div>
  </div>`}function je(e){const t=document.getElementById("auth-toggle");t&&(t.onclick=()=>L(e==="login"?"register":"login"));const s=document.getElementById("auth-submit");s&&(s.onclick=()=>e==="login"?Oe():Me(),s.onkeydown=o=>{o.key==="Enter"&&s.click()});const n=document.getElementById("auth-overlay");n&&(n.onkeydown=o=>{var a;o.key==="Enter"&&((a=document.getElementById("auth-submit"))==null||a.click())})}function S(e){const t=document.getElementById("auth-error");t&&(t.textContent=e,t.style.display="block")}async function Me(){var n,o,a;const e=((n=document.getElementById("auth-username"))==null?void 0:n.value.trim())??"",t=(o=document.getElementById("auth-password"))==null?void 0:o.value,s=(a=document.getElementById("auth-password2"))==null?void 0:a.value;if(!e||!t){S("Username and password required");return}if(t!==s){S("Passwords do not match");return}try{const i=await Se(e,t);k.setUser(i),C(),v.ok(`Welcome, ${i.username}`)}catch(i){S(i.message||"Registration failed")}}async function Oe(){var s,n;const e=((s=document.getElementById("auth-username"))==null?void 0:s.value.trim())??"",t=(n=document.getElementById("auth-password"))==null?void 0:n.value;if(!e||!t){S("Username and password required");return}try{const o=await Te(e,t);k.setUser(o),C(),v.ok(`Welcome back, ${o.username}`)}catch(o){S(o.message||"Invalid credentials")}}async function se(){try{await Be()}catch{}k.clear(),L("login"),v.info("Signed out")}function C(){const e=document.getElementById("auth-overlay"),t=document.getElementById("app");e&&(e.style.display="none"),t&&t.classList.add("is-ready")}async function ne(e){const t=await Le();t?(k.setUser(t),C()):L("login"),e()}function oe(){$e(()=>{k.clear(),L("login"),v.warn("Session expired — please sign in again")})}const Ae=Object.freeze(Object.defineProperty({__proto__:null,doLogout:se,renderAuth:L,restoreSession:ne,showApp:C,wireUnauthorizedAutoLogout:oe},Symbol.toStringTag,{value:"Module"}));class Ne extends B{constructor(){super(...arguments);f(this,"executions",[]);f(this,"currentExecId",null)}applyEvent(s){switch(s.type){case"agent_executions":{const n=s.executions??[];this.executions=n.map(o=>({...o,messages:o.messages??[]})),this.notify();break}case"agent_exec_started":{const n=s.exec_id;this.executions.find(o=>o.id===n)||this.executions.unshift({id:n,agent_type:s.agent_type,session_id:s.session_id,prompt:s.prompt,status:"running",messages:[],created_at:new Date().toISOString()}),this.notify();break}case"agent_session_created":{this.notify();break}case"agent_message":{const n=s.exec_id??this.currentExecId,o=this.executions.find(a=>a.id===n);o&&(o.messages.push({type:s.msg_type,content:s.content,tool_name:s.tool_name,tool_input:s.tool_input,raw_json:s.raw_json,error:s.error}),s.is_final&&(o.status="completed")),this.notify();break}case"agent_error":{const n=s.exec_id??this.currentExecId,o=this.executions.find(a=>a.id===n);o&&(o.status="error",o.error=s.error),this.notify();break}case"agent_cancelled":{const n=s.exec_id,o=this.executions.find(a=>a.id===n);o&&(o.status="cancelled"),this.notify();break}}}setCurrent(s){this.currentExecId=s,this.notify()}}const _=new Ne;class He extends B{constructor(){super(...arguments);f(this,"tree",null);f(this,"selectedWorkspaceId",null);f(this,"selectedTopicId",null);f(this,"selectedStoryId",null);f(this,"selectedTopicName","");f(this,"expandedNodes",{})}setTree(s){var n;this.tree=s,this.selectedWorkspaceId===null&&((n=s.workspaces)!=null&&n.length)&&(this.selectedWorkspaceId=s.workspaces[0].workspace.id),this.notify()}applyEvent(s){(s.type==="hierarchy_snapshot"||s.type==="hierarchy_updated")&&this.setTree(s.hierarchy)}selectWorkspace(s){this.selectedWorkspaceId=s,this.selectedTopicId=null,this.selectedStoryId=null,this.notify()}selectTopic(s,n){this.selectedTopicId=s,this.selectedStoryId=null,this.selectedTopicName=n,this.expandedNodes["topic_"+s]=!0,this.notify()}selectStory(s){this.selectedStoryId=s,this.selectedTopicId=null,this.notify()}toggleNode(s){const n=this.expandedNodes[s]!==!1;this.expandedNodes[s]=!n,this.notify()}}const p=new He,ae=["active","idle","stopped","disappeared","unknown","error"];class De extends B{constructor(){super(...arguments);f(this,"sessions",{});f(this,"currentFilter","all");f(this,"agentTypeFilter","");f(this,"selectedSessionKey",null);f(this,"expandedCards",{});f(this,"expandedTurns",{});f(this,"expandedToolGroups",{});f(this,"expandedPayloads",{});f(this,"draftInputs",{});f(this,"timelineSearch",{});f(this,"timelineTurnFilter",{})}applyEvent(s){switch(s.type){case"snapshot":{this.sessions={};const n=s.sessions??[];for(const o of n)this.sessions[o.session_key]=o;this.notify();break}case"session_added":{const n=s.session;n&&(this.sessions[n.session_key]=n),this.notify();break}case"delta":{this.applyDelta(s);break}}}applyDelta(s){const n=s.session_key,o=s.changes;if(!n||!o)return;const a=this.sessions[n];if(!a)return;const i={...a};for(const c of Object.keys(o)){if(c==="turns"){const l=o.turns;i.turns=l?l.slice():[];continue}i[c]=o[c]}this.sessions[n]=i,this.notify()}setFilter(s){this.currentFilter=s,this.notify()}setAgentTypeFilter(s){this.agentTypeFilter=s,this.notify()}setDraftInput(s,n){this.draftInputs[s]=n}setTimelineSearch(s,n){this.timelineSearch[s]=n,this.notify()}setTimelineTurnFilter(s,n){this.timelineTurnFilter[s]=n,this.notify()}toggleCard(s){this.expandedCards[s]=!this.expandedCards[s],this.notify()}toggleTurn(s,n){const o=`${s}_turn_${n}`;this.expandedTurns[o]=!this.expandedTurns[o],this.notify()}toggleToolGroup(s,n,o){const a=`${s}_${n}_${o}`;this.expandedToolGroups[a]=!this.expandedToolGroups[a],this.notify()}toggleToolDetail(s){this.expandedToolGroups[s]=!this.expandedToolGroups[s],this.notify()}toggleEntryPayload(s,n,o){const a=`${s}_${n}_${o}`;this.expandedPayloads[a]=!this.expandedPayloads[a],this.notify()}togglePayload(s){this.expandedPayloads[s]=!this.expandedPayloads[s],this.notify()}filteredList(s,n){let o=Object.values(this.sessions);return n?o=o.filter(a=>a.session_key===n):s&&s.size>0?o=o.filter(a=>s.has(a.session_key)):s&&(o=[]),this.currentFilter!=="all"&&We(this.currentFilter)?o=o.filter(a=>a.status===this.currentFilter):this.currentFilter!=="all"&&Ue(this.currentFilter)&&(o=o.filter(a=>a.agent_type===this.currentFilter)),this.agentTypeFilter&&(o=o.filter(a=>a.agent_type===this.agentTypeFilter)),o.sort((a,i)=>i.last_event_time_ms-a.last_event_time_ms),o}statusCounts(){const s={};for(const n of Object.values(this.sessions))s[n.status]=(s[n.status]??0)+1;return s}agentTypeCounts(){const s={};for(const n of Object.values(this.sessions))s[n.agent_type]=(s[n.agent_type]??0)+1;return s}}function We(e){return ae.includes(e)}function Ue(e){return e==="claude"||e==="opencode"||e==="codex"}const y=new De,Fe=6e4;class Re extends B{constructor(){super(...arguments);f(this,"_current","disconnected")}current(){return this._current}set(s){s!==this._current&&(this._current=s,this.notify())}}const E=new Re;class qe{constructor(){f(this,"es",null);f(this,"handlers",new Set);f(this,"deadTimer",null);f(this,"bc",null);f(this,"leaderHeartbeat",null);f(this,"followerWait",null);f(this,"isLeader",!1);f(this,"disposed",!1);f(this,"closeRetries",0);this.initBroadcastChannel()}connect(){this.disposed||(E.set("connecting"),this.bc?(this.bc.postMessage({kind:"whois_leader"}),this.followerWait=setTimeout(()=>this.becomeLeader(),500)):this.becomeLeader())}initBroadcastChannel(){if(!(typeof BroadcastChannel>"u"))try{this.bc=new BroadcastChannel("agent-monitor-sse"),this.bc.onmessage=t=>this.onBCMessage(t.data),window.addEventListener("beforeunload",()=>{var t;this.isLeader&&((t=this.bc)==null||t.postMessage({kind:"leader_gone"}))})}catch{this.bc=null}}onBCMessage(t){var s;switch(t.kind){case"leader_here":this.followerWait&&(clearTimeout(this.followerWait),this.followerWait=null);break;case"leader_heartbeat":this.followerWait&&clearTimeout(this.followerWait),this.followerWait=setTimeout(()=>this.becomeLeader(),5e3);break;case"leader_gone":case"whois_leader":this.isLeader&&((s=this.bc)==null||s.postMessage({kind:"leader_here"})),t.kind==="leader_gone"&&!this.isLeader&&(this.followerWait&&clearTimeout(this.followerWait),this.followerWait=setTimeout(()=>this.becomeLeader(),200));break;case"relay_event":t.event&&this.dispatch(t.event);break}}becomeLeader(){var t;this.isLeader||(this.isLeader=!0,(t=this.bc)==null||t.postMessage({kind:"leader_here"}),this.leaderHeartbeat=setInterval(()=>{var s;(s=this.bc)==null||s.postMessage({kind:"leader_heartbeat"})},3e3),this.openEventSource())}openEventSource(){this.es&&this.es.close(),E.set("connecting");const t=te+Ee;try{this.es=new EventSource(t,{withCredentials:!0})}catch{E.set("disconnected"),this.dispatch({type:"agent_error",error:"EventSource unsupported",__auth:!0});return}this.es.onopen=()=>{this.closeRetries=0,E.set("connected"),this.resetDeadTimer()},this.es.onmessage=s=>{var n;this.resetDeadTimer();try{const o=JSON.parse(s.data);this.dispatch(o),(n=this.bc)==null||n.postMessage({kind:"relay_event",event:o})}catch{}},this.es.onerror=()=>{var s;if(((s=this.es)==null?void 0:s.readyState)===2){if(this.clearDeadTimer(),this.closeRetries=(this.closeRetries||0)+1,this.closeRetries>=3){E.set("disconnected"),this.dispatch({type:"agent_error",error:"sse_closed",__auth:!0});return}E.set("connecting"),setTimeout(()=>this.openEventSource(),1500);return}E.set("connecting"),this.resetDeadTimer()},this.resetDeadTimer()}resetDeadTimer(){this.deadTimer&&clearTimeout(this.deadTimer),this.deadTimer=setTimeout(()=>{this.es&&this.es.close(),this.openEventSource()},Fe)}clearDeadTimer(){this.deadTimer&&clearTimeout(this.deadTimer),this.deadTimer=null}dispatch(t){for(const s of this.handlers)try{s(t)}catch{}}on(t){this.handlers.add(t)}off(t){this.handlers.delete(t)}close(){if(this.disposed=!0,this.clearDeadTimer(),this.leaderHeartbeat&&clearInterval(this.leaderHeartbeat),this.followerWait&&clearTimeout(this.followerWait),this.es&&this.es.close(),this.es=null,this.isLeader&&this.bc&&this.bc.postMessage({kind:"leader_gone"}),this.bc)try{this.bc.close()}catch{}this.bc=null,E.set("disconnected")}}function u(e){return e==null||e===!1?"":String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function T(e,t){return e?e.length>t?e.slice(0,t)+"...":e:"-"}function ie(e){return e?new Date(e).toLocaleTimeString("en-US",{hour12:!1}):""}function W(e,t){if(!e||e==="null")return t;try{const n={...typeof e=="string"?JSON.parse(e):{...e}};return delete n.daemon_token,delete n._role,JSON.stringify(n,null,2)}catch{return t}}async function Je(){return g("/api/hierarchy")}async function ze(e,t=""){await g("/api/workspaces",{method:"POST",body:JSON.stringify({name:e,description:t})})}async function Ke(e,t,s=""){await g(`/api/workspaces/${e}/projects`,{method:"POST",body:JSON.stringify({name:t,description:s})})}async function Ve(e,t,s,n="",o=""){await g(`/api/workspaces/${e}/projects/${t}/topics`,{method:"POST",body:JSON.stringify({name:s,description:o,agent_type:n})})}async function Ge(e,t,s,n,o=""){await g(`/api/workspaces/${e}/projects/${t}/topics/${s}/stories`,{method:"POST",body:JSON.stringify({name:n,description:o})})}async function Ze(e,t,s=""){await g(`/api/stories/${e}`,{method:"PUT",body:JSON.stringify({name:t,description:s})})}async function Xe(e){await g(`/api/stories/${e}`,{method:"DELETE"})}async function Qe(e,t){return g(`/api/permissions/${e}/${t}`)}async function Ye(e,t,s,n){await g(`/api/permissions/${e}/${t}`,{method:"PUT",body:JSON.stringify({user_id:s,level:n})})}async function et(e,t,s){await g(`/api/permissions/${e}/${t}/${s}`,{method:"DELETE"})}async function tt(){return g("/api/users")}function re(e,t){const s=document.getElementById("modal-box"),n=document.getElementById("modal-overlay");if(!s||!n)return;const a={workspace:["Workspace Name",""],project:["Project Name",""],topic:["Topic Name","agent_type (optional)"]}[e];s.innerHTML=`
    <h3>New ${u(e)}</h3>
    <label class="field-label" for="modal-name">${u(a[0])}</label>
    <input type="text" id="modal-name" placeholder="${u(a[0])}" autofocus>
    ${e==="topic"?'<label class="field-label" for="modal-agent">Agent type</label><input type="text" id="modal-agent" placeholder="claude / codex / opencode">':""}
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Create</button>
    </div>`,n.style.display="flex",P("modal-cancel"),U("modal-name",()=>V(e,t));const i=document.getElementById("modal-create");i&&(i.onclick=()=>V(e,t))}function ce(e,t){const s=document.getElementById("modal-box"),n=document.getElementById("modal-overlay");if(!s||!n)return;s.innerHTML=`
    <h3>Rename Story</h3>
    <label class="field-label" for="modal-name">New name</label>
    <input type="text" id="modal-name" value="${u(t)}" autofocus>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Save</button>
    </div>`,n.style.display="flex",P("modal-cancel");const o=async()=>{var l;const i=((l=document.getElementById("modal-name"))==null?void 0:l.value.trim())??"";if(!i){v.warn("Name is required");return}const c=document.getElementById("modal-create");c&&(c.disabled=!0,c.textContent="Saving…");try{await Ze(e,i),I(),await $(),v.ok("Story renamed")}catch(m){v.error("Rename failed: "+(m.message||"unknown"))}finally{c&&(c.disabled=!1,c.textContent="Save")}};U("modal-name",o);const a=document.getElementById("modal-create");a&&(a.onclick=o)}function le(e,t){const s=document.getElementById("modal-box"),n=document.getElementById("modal-overlay");if(!s||!n)return;s.innerHTML=`
    <h3>Delete story?</h3>
    <p>“${u(t)}” will be removed permanently.</p>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-danger" id="modal-delete">Delete</button>
    </div>`,n.style.display="flex",P("modal-cancel");const o=document.getElementById("modal-delete");o&&(o.onclick=()=>F(e))}function P(e){const t=document.getElementById(e);t&&(t.onclick=()=>I())}function U(e,t){const s=document.getElementById(e);s&&(s.onkeydown=n=>{n.key==="Enter"&&t()})}function I(){const e=document.getElementById("modal-overlay");e&&(e.style.display="none")}async function V(e,t){var a,i;const s=((a=document.getElementById("modal-name"))==null?void 0:a.value.trim())??"";if(!s){v.warn("Name is required");return}const n=document.getElementById("modal-create");n&&(n.disabled=!0,n.textContent="Creating…");const o=p.selectedWorkspaceId??1;try{switch(e){case"workspace":await ze(s);break;case"project":await Ke(o,s);break;case"topic":{const c=((i=document.getElementById("modal-agent"))==null?void 0:i.value.trim())??"";await Ve(o,t,s,c);break}}I(),await $(),v.ok(`${e} created`)}catch(c){v.error("Create failed: "+(c.message||"unknown"))}}async function de(e){st(e)}function st(e){const t=document.getElementById("modal-box"),s=document.getElementById("modal-overlay");if(!t||!s)return;t.innerHTML=`
    <h3>New Story under Topic ${e}</h3>
    <label class="field-label" for="modal-name">Story name</label>
    <input type="text" id="modal-name" autofocus>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Create</button>
    </div>`,s.style.display="flex",P("modal-cancel"),U("modal-name",()=>G(e));const n=document.getElementById("modal-create");n&&(n.onclick=()=>G(e))}async function G(e){var o,a,i;const t=((o=document.getElementById("modal-name"))==null?void 0:o.value.trim())??"";if(!t){v.warn("Name is required");return}const s=p.selectedWorkspaceId??1;let n=0;for(const c of((a=p.tree)==null?void 0:a.workspaces)??[])for(const l of c.projects??[])if((i=l.topics)!=null&&i.some(m=>m.topic.id===e)){n=l.project.id;break}if(!n){v.error("Topic not found — refresh and try again");return}try{await Ge(s,n,e,t),I(),await $(),v.ok("Story created")}catch(c){v.error("Create story failed: "+(c.message||"unknown"))}}async function ue(e){var s,n;let t="";for(const o of((s=p.tree)==null?void 0:s.workspaces)??[])for(const a of o.projects??[])for(const i of a.topics??[]){const c=(n=i.stories)==null?void 0:n.find(l=>l.id===e);if(c){t=c.name;break}}ce(e,t)}async function F(e){var n,o;let t="";for(const a of((n=p.tree)==null?void 0:n.workspaces)??[])for(const i of a.projects??[])for(const c of i.topics??[]){const l=(o=c.stories)==null?void 0:o.find(m=>m.id===e);if(l){t=l.name;break}}le(e,t);const s=document.getElementById("modal-delete");s&&(s.onclick=async()=>{try{await Xe(e),I(),await $(),v.ok("Story deleted")}catch(a){v.error("Delete failed: "+(a.message||"unknown"))}})}async function $(){try{const e=await Je();p.setTree(e)}catch(e){v.error("Hierarchy refresh failed: "+(e.message||"unknown"))}}function pe(e,t){const s={workspace:"Workspace",project:"Project"},n=document.getElementById("modal-box"),o=document.getElementById("modal-overlay");if(!n||!o)return;n.innerHTML=`
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
    <div class="modal-actions"><button class="btn-cancel" id="perm-close">Close</button></div>`,o.style.display="flex",P("perm-close");const a=document.getElementById("perm-add");a&&(a.onclick=()=>ot(e,t)),R(e,t),nt()}async function R(e,t){const s=document.getElementById("perm-list");if(s)try{const n=await Qe(e,t);if(n.length===0){s.innerHTML='<div class="perm-empty">No permissions set</div>';return}s.innerHTML=n.map(o=>`
      <div class="perm-row" data-perm-uid="${o.user_id}">
        <span class="perm-user">User #${o.user_id}<span class="perm-level"> (${o.level>=100?"Admin":"Viewer"})</span></span>
        <button class="perm-remove" data-uid="${o.user_id}" aria-label="Revoke">✕</button>
      </div>`).join(""),s.querySelectorAll("[data-uid]").forEach(o=>{o.onclick=async()=>{const a=parseInt(o.dataset.uid??"0",10);try{await et(e,t,a),v.ok("Permission revoked"),R(e,t)}catch(i){v.error("Revoke failed: "+(i.message||"unknown"))}}})}catch{s.innerHTML='<div class="perm-empty">Failed to load</div>'}}async function nt(){try{const e=await tt(),t=document.getElementById("perm-user-select");if(!t)return;t.innerHTML=e.map(s=>`<option value="${s.id}">${u(s.username)}</option>`).join("")}catch{}}async function ot(e,t){var o,a;const s=parseInt(((o=document.getElementById("perm-user-select"))==null?void 0:o.value)??"0"),n=parseInt(((a=document.getElementById("perm-level-select"))==null?void 0:a.value)??"0");if(s)try{await Ye(e,t,s,n),v.ok("Permission added"),R(e,t)}catch(i){v.error("Add permission failed: "+(i.message||"unknown"))}}const O=Object.freeze(Object.defineProperty({__proto__:null,closeModal:I,onCreateStory:de,onDeleteStory:F,onEditStory:ue,refreshHierarchy:$,showCreateModal:re,showDeleteStoryModal:le,showEditStoryModal:ce,showPermissionModal:pe},Symbol.toStringTag,{value:"Module"}));function at(){const e=p.tree,t=document.getElementById("sidebar-tree");if(!t||!e||!e.workspaces)return;const s=e.workspaces.find(o=>o.workspace.id===p.selectedWorkspaceId);if(!s){t.innerHTML="";return}let n="";if(s.projects)for(const o of s.projects)n+=rt(o);n+='<div class="tree-separator"></div>',t.innerHTML=n}function it(){const e=document.getElementById("sidebar-tree");e&&lt(e)}function rt(e){const t="proj_"+e.project.id,s=p.expandedNodes[t]!==!1,n=(e.topics||[]).length;let o=`<div class="tree-node tree-project" data-action="toggle-proj" data-id="${t}">
    <span class="arrow${s?" open":""}">▸</span>
    <span class="node-icon">&#9632;</span>
    <span class="label">${u(e.project.name)}</span>
    ${n>0?`<span class="count">${n}</span>`:""}
    <span class="add-child" data-action="create-topic" data-id="${e.project.id}">+</span>
    <span class="add-child" data-action="show-perm-project" data-id="${e.project.id}">👥</span>
  </div>`;if(o+=`<div class="tree-children${s?" open":""}" id="${t}">`,e.topics)for(const a of e.topics)o+=ct(a);return o+="</div>",o}function ct(e){var i;const t="topic_"+e.topic.id,s=p.expandedNodes[t]!==!1,n=p.selectedTopicId===e.topic.id?" selected":"",o=((i=e.stories)==null?void 0:i.length)??0;let a=`<div class="tree-node tree-topic${n}" data-action="select-topic" data-id="${e.topic.id}">
    <span class="arrow${s?" open":""}" data-action="toggle-node" data-id="${t}">▸</span>
    <span class="node-icon">&#9679;</span>
    <span class="label">${u(e.topic.name)}</span>
    ${o>0?`<span class="count">${o}</span>`:""}
    <span class="add-child" data-action="create-story" data-id="${e.topic.id}">+</span>
  </div>`;if(e.stories&&e.stories.length>0){a+=`<div class="tree-children${s?" open":""}" id="${t}">`;for(const c of e.stories){const l=c.session_key,m=p.selectedStoryId===c.id?" selected":"",d=l?y.sessions[l]:null,r=c.name,h=d?d.session_title||T(d.agent_session_id,20):"";a+=`<div class="tree-node tree-story${m}" data-action="select-story" data-id="${c.id}">
        <span class="node-icon">&#8728;</span>
        <span class="label" title="${u(h)}">${u(T(r,28))}</span>
        <span class="add-child" data-action="edit-story" data-id="${c.id}">✎</span>
        <span class="add-child" data-action="delete-story" data-id="${c.id}">✕</span>
      </div>`}a+="</div>"}return a}function lt(e){e.addEventListener("click",t=>{const n=t.target.closest("[data-action]");if(!n)return;const o=n.dataset.action,a=n.dataset.id??"";switch(o){case"toggle-proj":p.toggleNode(a);break;case"toggle-node":t.stopPropagation(),p.toggleNode(a);break;case"select-topic":p.selectTopic(parseInt(a,10),"");break;case"select-story":p.selectStory(parseInt(a,10));break;case"show-perm-project":t.stopPropagation(),pe("project",parseInt(a,10));break;case"create-topic":t.stopPropagation(),re("topic",parseInt(a,10));break;case"create-story":t.stopPropagation(),de(parseInt(a,10));break;case"edit-story":t.stopPropagation(),ue(parseInt(a,10));break;case"delete-story":t.stopPropagation(),F(parseInt(a,10));break}})}async function dt(e,t,s,n=10,o){return g(`/api/agent/${e}/sessions/${encodeURIComponent(t)}/prompt`,{method:"POST",body:JSON.stringify({prompt:s,session_id:t,timeout_minutes:n,workspace_id:o??void 0})})}async function ut(e,t,s){const n=s?`?exec_id=${encodeURIComponent(s)}`:"";await g(`/api/agent/${e}/sessions/${encodeURIComponent(t)}/cancel${n}`,{method:"POST"})}async function pt(e,t){await g(`/api/sessions/${encodeURIComponent(e)}/input`,{method:"POST",body:JSON.stringify({text:t})})}function mt(e,t){if(!(e!=null&&e.length))return"";let s='<div class="timeline">';return[...e].reverse().forEach((n,o)=>{const a=n.turn_idx,i=`${t}_turn_${a}`,c=o===0;i in y.expandedTurns||(y.expandedTurns[i]=c);const l=y.expandedTurns[i];s+=`<div class="turn-block${l?" is-open":""}">
      <div class="turn-header" role="button" tabindex="0" aria-expanded="${l}" data-action="toggle-turn" data-key="${u(t)}" data-ti="${a}">
        <span class="turn-title">Turn ${(n.turn_idx??0)+1}</span>
        <span class="turn-time">${u(ie(n.user_ts||0))}</span>
        <span class="turn-arrow" aria-hidden="true">${l?"▼":"▶"}</span>
      </div>
      <div class="turn-body${l?" open":""}">`,n.user_input&&(s+=`<div class="user-input-block">${u(n.user_input)}</div>`);let m=0;for(const d of n.entries||[])if(d.tools&&d.tools.length>0)for(const r of d.tools){const h=`${t}_${a}_tc_${m++}`,b=y.expandedToolGroups[h];s+=`<div class="tool-group status-${u(r.status)}${b?" is-open":""}">
            <div class="tool-header" role="button" tabindex="0" aria-expanded="${!!b}" data-action="toggle-tool" data-id="${h}">
              <span class="tool-name">${u(r.name)}</span>
              <span class="tool-status ${u(r.status)}">${r.status==="running"?'<span class="pulse"></span>':""}${u(r.status)}</span>
              <span class="tool-duration">${r.end_ts?r.end_ts-r.start_ts+"ms":"..."}</span>
              <span class="tool-arrow" aria-hidden="true">${b?"▼":"▶"}</span>
            </div>
            <div class="tool-detail${b?" open":""}">${u(ht(r,d))}</div>
          </div>`}else s+=ft(d,t,a,m++);s+="</div></div>"}),s+="</div>",s}function ft(e,t,s,n){const o=`${t}_${s}_${n}`;o in y.expandedPayloads||(y.expandedPayloads[o]=!1);const a=y.expandedPayloads[o],i=W(e.payload,e.event),c=e.ts?` · ${ie(e.ts)}`:"",l=me(e)?'<span class="timeline-final-badge">Final</span>':"",m=vt(e),d=yt(e.event);return`<div class="timeline-event event-${m}${a?" is-open":""}${l?" is-final":""}" data-entry="${n}">
    <div class="timeline-event-header" role="button" tabindex="0" aria-expanded="${a}" data-action="toggle-entry" data-key="${u(t)}" data-ti="${s}" data-ei="${n}">
      <span class="timeline-event-dot" aria-hidden="true"></span>
      <span class="timeline-event-main">
        <span class="timeline-event-name">${u(d)}</span>
        <span class="timeline-event-meta">${u(e.event)}${u(c)}</span>
      </span>
      ${l}
      <span class="timeline-event-arrow" aria-hidden="true">${a?"▼":"▶"}</span>
    </div>
    <pre class="timeline-event-payload${a?" open":""}">${u(i)}</pre>
  </div>`}function ht(e,t){const s=[];e.input&&s.push(`input:
${e.input}`),e.output&&s.push(`output:
${e.output}`);const n=W(t.payload,t.event);return n&&s.push(`raw:
${n}`),s.join(`

`)}function me(e){const t=fe(e.payload);if(e.event==="Stop"||e.event==="SDKComplete")return!0;if(!t)return!1;if(t.is_final===!0||t.final===!0||t.last_assistant_message||t.model_output)return!0;const s=typeof t.type=="string"?t.type:"";return s==="result"||s==="done"}function vt(e){const t=e.event.toLowerCase(),s=fe(e.payload),n=typeof(s==null?void 0:s.type)=="string"?s.type.toLowerCase():"";return me(e)?"final":t.includes("reason")||n.includes("reason")?"reasoning":t.includes("assist")||t.includes("message")||n.includes("message")?"assistant":t.includes("tool")?"tool":t.includes("error")||t.includes("fail")||t.includes("denied")?"error":t.includes("compact")||t.includes("session")||t.includes("config")?"system":"raw"}function yt(e){return e.replace(/SDK/g,"SDK ").replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/\s+/g," ").trim()||e}function fe(e){if(!e||e==="null")return null;if(typeof e=="string")try{return JSON.parse(e)}catch{return null}return typeof e=="object"?e:null}function gt(){const e=document.getElementById("session-detail-panel");e&&(e.addEventListener("click",t=>{const n=t.target.closest("[data-action]");if(!n)return;const o=n.dataset.action,a=n.dataset.key??"",i=parseInt(n.dataset.ti??"0",10);switch(o){case"toggle-turn":t.stopPropagation(),y.toggleTurn(a,i);break;case"toggle-tool":t.stopPropagation();const c=n.dataset.id??"";y.toggleToolDetail(c);break;case"toggle-entry":t.stopPropagation(),y.toggleEntryPayload(a,i,parseInt(n.dataset.ei??"0",10));break}}),e.addEventListener("keydown",t=>{if(t.key!=="Enter"&&t.key!==" ")return;const n=t.target.closest("[data-action]");n&&(t.preventDefault(),n.click())}))}function Z(){const e=document.getElementById("session-list-body");if(!e)return;let t=null,s=null;if(p.selectedStoryId&&p.tree){if(s=kt(p.selectedStoryId),!s){e.innerHTML='<div class="empty-state"><h3>No sessions linked</h3><p>This story is not yet linked to a session.</p></div>';return}}else p.selectedTopicId&&p.tree&&(t=Et(p.selectedTopicId));const n=y.filteredList(t,s);if(n.length===0){e.innerHTML='<div class="empty-state"><h3>No sessions</h3><p>Select a topic on the left or wait for agent events.</p></div>';return}e.innerHTML=n.map(o=>bt(o)).join(""),e.querySelectorAll(".session-row").forEach(o=>{o.addEventListener("click",()=>{e.querySelectorAll(".session-row").forEach(i=>i.classList.remove("selected")),o.classList.add("selected");const a=o.dataset.key||"";y.selectedSessionKey=a,he()})})}function bt(e){const t=u(e.session_key),s=y.selectedSessionKey===e.session_key?" selected":"",n=e.session_title||e.agent_session_id||t,o=[T(e.agent_session_id,20),e.terminal||"-",e.memory_mb?`${e.memory_mb.toFixed(0)}MB`:""].filter(Boolean).join(" · ");return`<div class="session-row${s}" data-key="${t}">
    <span class="row-status ${e.status}"></span>
    <span class="agent-badge ${e.agent_type}">${u(e.agent_type)}</span>
    <span class="row-info">
      <span class="row-title">${u(n)}</span>
      <span class="row-sub">${u(o)}</span>
    </span>
    <span class="row-meta">
      <span>T${e.turn_count||0}</span>
      <span class="cpu" style="color:${e.cpu_percent?"var(--accent)":"var(--text-tertiary)"}">${e.cpu_percent?e.cpu_percent.toFixed(0)+"%":"—"}</span>
    </span>
  </div>`}function he(){const e=document.getElementById("session-detail-panel");if(!e)return;if(!y.selectedSessionKey){e.innerHTML='<div class="empty-state" id="detail-empty"><h3>Select a session</h3><p>Choose a session from the list to view its timeline and details.</p></div>';return}const t=y.sessions[y.selectedSessionKey];if(!t){e.innerHTML='<div class="empty-state"><h3>Session not found</h3></div>';return}const s=e.scrollTop,n="detail-input-"+u(t.session_key),o=document.getElementById(n),a=o?o.value:y.draftInputs[t.session_key]||"",i=t.session_title||t.agent_session_id,c=t.turns&&t.turns.length>0,l=t.status==="error"||t.status==="disappeared"||t.status==="unknown",m="";e.innerHTML=`<div class="session-detail-content">
    <div class="detail-header">
      <span class="agent-badge ${t.agent_type}">${u(t.agent_type)}</span>
      <span class="detail-title">${u(i)}</span>
      <span class="status-badge ${t.status}">${t.status}</span>
      <div class="detail-actions">${m}</div>
    </div>
    ${l?wt(t):""}
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Session</div><div class="info-value">${u(T(t.agent_session_id,16))}</div></div>
      <div class="info-item"><div class="info-label">PID</div><div class="info-value">${t.pid||"—"}</div></div>
      <div class="info-item"><div class="info-label">Terminal</div><div class="info-value">${u(t.terminal||"—")}</div></div>
      <div class="info-item"><div class="info-label">CWD</div><div class="info-value">${u(T(t.cwd||"",36))}</div></div>
      <div class="info-item"><div class="info-label">Turns</div><div class="info-value">${t.turn_count||0}</div></div>
      <div class="info-item"><div class="info-label">CPU / Memory</div><div class="info-value">${t.cpu_percent?t.cpu_percent.toFixed(0)+"%":"—"} · ${t.memory_mb?t.memory_mb.toFixed(0)+" MB":"—"}</div></div>
    </div>
    ${c?'<div class="detail-section-title">Timeline</div>'+mt(t.turns,t.session_key):""}
    <div class="session-input-row">
      <input type="text" id="detail-input-${u(t.session_key)}" placeholder="Send input to this session...">
      <button class="btn btn-primary" data-send="${u(t.session_key)}">Send</button>
    </div>
  </div>`;const d=e.querySelector(`[data-send="${u(t.session_key)}"]`);d&&d.addEventListener("click",()=>X(t.session_key));const r=e.querySelector("input");r&&(r.onkeydown=b=>{b.key==="Enter"&&X(t.session_key)});const h=document.getElementById(n);h&&a&&(h.value=a),e.scrollTop=s}function wt(e){return`<div class="error-alert">
    <div class="error-alert-title">${e.status==="error"?"Error":"Process disconnected"}</div>
    <div class="error-alert-detail">${u(e.agent_output||"No additional details.")}</div>
  </div>`}async function X(e){const t=document.getElementById("detail-input-"+e);if(!t)return;const s=t.value.trim();if(s)try{await pt(e,s),t.value="",v.ok("Sent")}catch{v.error("Send failed")}}function kt(e){var t;for(const s of((t=p.tree)==null?void 0:t.workspaces)??[])for(const n of s.projects??[])for(const o of n.topics??[])for(const a of o.stories??[])if(a.id===e)return a.session_key||null;return null}function Et(e){var s;const t=new Set;for(const n of((s=p.tree)==null?void 0:s.workspaces)??[])for(const o of n.projects??[])for(const a of o.topics??[])if(a.topic.id===e)for(const i of a.stories??[])i.session_key&&t.add(i.session_key);return t}function _t(){const e=document.getElementById("agent-panel");if(!e)return;e.className="agent-panel",e.innerHTML=`
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
    </div>`;const t=document.getElementById("agent-panel-header"),s=document.getElementById("agent-panel-body"),n=document.getElementById("agent-panel-arrow");t&&s&&n&&(t.onclick=()=>{const i=s.classList.toggle("open");n.classList.toggle("open",i)});const o=document.getElementById("agent-send");o&&(o.onclick=It);const a=document.getElementById("agent-cancel");a&&(a.onclick=$t)}async function It(){var i,c,l;const e=((i=document.getElementById("agent-select"))==null?void 0:i.value)??"claude",t=((c=document.getElementById("agent-session-id"))==null?void 0:c.value.trim())??"",s=document.getElementById("agent-prompt"),n=(s==null?void 0:s.value.trim())??"",o=parseInt(((l=document.getElementById("agent-timeout"))==null?void 0:l.value)??"10")||10;if(!n){v.warn("Prompt is empty");return}const a=document.getElementById("agent-status");a&&(a.textContent="Running…");try{const m=await dt(e,t,n,o,p.selectedWorkspaceId);s&&(s.value="");const d=document.getElementById("agent-session-id");d&&!t&&(d.value=m.session_id),_.setCurrent(m.exec_id),v.ok("Execution started")}catch(m){a&&(a.textContent="Error"),v.error("Send failed: "+(m.message||"unknown"))}}async function $t(){var n,o;const e=((n=document.getElementById("agent-select"))==null?void 0:n.value)??"claude",t=((o=document.getElementById("agent-session-id"))==null?void 0:o.value.trim())??"",s=document.getElementById("agent-status");s&&(s.textContent="Cancelling…");try{await ut(e,t,_.currentExecId??void 0),v.info("Cancelled")}catch(a){s&&(s.textContent="Error"),v.error("Cancel failed: "+(a.message||"unknown"))}}function xt(){const e=document.getElementById("agent-output");if(!e)return;if(_.executions.length===0){e.classList.remove("is-open"),e.innerHTML="";return}e.classList.add("is-open");const t=_.executions.find(n=>n.id===_.currentExecId),s=document.getElementById("agent-status");if(t&&s){const n={completed:"Completed",error:"Error",cancelled:"Cancelled",running:"Running…"};s.textContent=n[t.status]||t.status}if(t){e.innerHTML=St(t);const n=e.querySelector('[data-action="exec-back"]');n&&(n.onclick=()=>{_.setCurrent(null)})}else e.innerHTML=_.executions.map(n=>`<div class="exec-row" data-exec="${u(n.id)}">${Tt(n.status)} <b>${u(n.agent_type??"")}</b> <span class="exec-preview">${u((n.prompt??"").slice(0,60))}</span></div>`).join(""),e.querySelectorAll("[data-exec]").forEach(n=>{n.onclick=()=>{_.setCurrent(n.dataset.exec??null)}})}function St(e){let t='<div class="exec-back" data-action="exec-back">← Back to history</div>';t+=`<div class="exec-prompt-label">Prompt: ${u(e.prompt??"")}</div>`;for(const s of e.messages)s.msg_type==="tool_use"||s.type==="tool_use"?t+=`<div class="msg-tool">[${u(s.tool_name??"tool")}] ${u(s.tool_input??"")}</div>`:s.content?t+=`<div class="msg-text">${u(s.content)}</div>`:s.error&&(t+=`<div class="msg-error">[ERROR] ${u(s.error)}</div>`),s.raw_json&&(t+=`<pre class="msg-raw">${u(W(s.raw_json,String(s.msg_type??s.type??"message")))}</pre>`);return e.status==="error"&&e.error&&(t+=`<div class="msg-error">[ERROR] ${u(e.error)}</div>`),t}function Tt(e){switch(e){case"running":return'<span class="exec-spin"></span>';case"completed":return'<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--success-text)" stroke-width="1.5"/><path d="M5 8l2 2 4-4" fill="none" stroke="var(--success-text)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';case"error":return'<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--danger-text)" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="var(--danger-text)" stroke-width="1.5" stroke-linecap="round"/></svg>';default:return'<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="var(--text-muted)" stroke-width="1.5"/></svg>'}}let w=null;function Bt(e){if(e.type==="agent_error"&&e.__auth){w&&(w.close(),w=null),k.clear(),M(async()=>{const{renderAuth:t}=await Promise.resolve().then(()=>Ae);return{renderAuth:t}},void 0).then(({renderAuth:t})=>t("login")),v.warn("Session expired — please sign in again");return}p.applyEvent(e),y.applyEvent(e),_.applyEvent(e)}function ve(){w&&w.close(),w=new qe,w.on(Bt),w.connect()}let ye="sessions";function Lt(){const e=document.getElementById("app");if(!e)return;e.innerHTML=`
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
    </div>`;const t=document.createElement("div");t.className="modal-overlay",t.id="modal-overlay",t.style.display="none",t.innerHTML='<div class="modal-box" id="modal-box"></div>',t.onclick=l=>{l.target===t&&I()},document.body.appendChild(t);const s=document.createElement("div");s.id="auth-overlay",s.style.display="none",document.body.prepend(s),Ct(),Pt(),it(),gt(),_t();const n=localStorage.getItem("agent-monitor-theme"),o=document.getElementById("theme-toggle");o&&(n==="light"&&(document.documentElement.setAttribute("data-theme","light"),o.innerHTML="&#9788;"),o.onclick=()=>{document.documentElement.getAttribute("data-theme")==="light"?(document.documentElement.removeAttribute("data-theme"),o.innerHTML="&#9790;",localStorage.setItem("agent-monitor-theme","dark")):(document.documentElement.setAttribute("data-theme","light"),o.innerHTML="&#9788;",localStorage.setItem("agent-monitor-theme","light"))});let a=p.selectedWorkspaceId,i=p.selectedTopicId,c=p.selectedStoryId;p.subscribe(()=>{(p.selectedWorkspaceId!==a||p.selectedTopicId!==i||p.selectedStoryId!==c)&&(a=p.selectedWorkspaceId,i=p.selectedTopicId,c=p.selectedStoryId,y.selectedSessionKey=null),at(),Z(),Q(),ee(),H()}),y.subscribe(()=>{Z(),he(),Q(),ee(),H()}),_.subscribe(()=>xt()),E.subscribe(()=>Y(E.current())),Y("disconnected")}function Ct(){const e=document.getElementById("ws-btn"),t=document.getElementById("ws-dropdown"),s=document.getElementById("ws-backdrop");e&&t&&s&&(e.onclick=()=>{t.classList.toggle("open"),s.classList.toggle("open")},s.onclick=()=>{t.classList.remove("open"),s.classList.remove("open")});const n=document.getElementById("user-btn"),o=document.getElementById("user-dropdown"),a=document.getElementById("user-backdrop");n&&o&&a&&(n.onclick=()=>{o.classList.toggle("open"),a.classList.toggle("open")},a.onclick=()=>{o.classList.remove("open"),a.classList.remove("open")});const i=document.getElementById("menu-signout");i&&(i.onclick=()=>{o==null||o.classList.remove("open"),a==null||a.classList.remove("open"),se()});const c=document.getElementById("menu-permissions");c&&(c.onclick=()=>{o==null||o.classList.remove("open"),a==null||a.classList.remove("open");const r=p.selectedWorkspaceId??1;M(async()=>{const{showPermissionModal:h}=await Promise.resolve().then(()=>O);return{showPermissionModal:h}},void 0).then(({showPermissionModal:h})=>h("workspace",r))});const l=document.getElementById("menu-agent-panel");l&&(l.onclick=()=>{o==null||o.classList.remove("open"),a==null||a.classList.remove("open");const r=document.getElementById("agent-panel"),h=document.getElementById("agent-panel-body");if(r){const b=r.style.display==="block";r.style.display=b?"none":"block",h&&h.classList.toggle("open",!b)}});const m=document.getElementById("ws-new-btn");m&&(m.onclick=()=>{t==null||t.classList.remove("open"),s==null||s.classList.remove("open"),M(async()=>{const{showCreateModal:r}=await Promise.resolve().then(()=>O);return{showCreateModal:r}},void 0).then(({showCreateModal:r})=>r("workspace",0))});const d=document.getElementById("sidebar-add-project");d&&(d.onclick=()=>{M(async()=>{const{showCreateModal:r}=await Promise.resolve().then(()=>O);return{showCreateModal:r}},void 0).then(({showCreateModal:r})=>{const h=p.selectedWorkspaceId??1;r("project",h)})})}function Pt(){document.querySelectorAll(".side-nav-item").forEach(e=>{e.addEventListener("click",()=>{document.querySelectorAll(".side-nav-item").forEach(s=>s.classList.remove("active")),e.classList.add("active");const t=e.dataset.view||"sessions";jt(t)})})}function jt(e){ye=e,document.querySelectorAll(".view-panel").forEach(s=>s.classList.remove("active"));const t=document.getElementById("view-"+e);t&&t.classList.add("active"),e==="dashboard"&&H()}function Q(){var m,d;const e=document.getElementById("ws-name");if(e&&p.tree){const r=(m=p.tree.workspaces)==null?void 0:m.find(h=>h.workspace.id===p.selectedWorkspaceId);r&&(e.textContent=r.workspace.name)}const t=document.getElementById("ws-options");t&&((d=p.tree)!=null&&d.workspaces)&&(t.innerHTML=p.tree.workspaces.map(r=>`
      <button class="ws-option${r.workspace.id===p.selectedWorkspaceId?" selected":""}" data-wid="${r.workspace.id}">
        <span class="ws-dot blue"></span> ${D(r.workspace.name)}
        <span class="ws-info">${(r.projects||[]).length}</span>
      </button>`).join(""),t.querySelectorAll(".ws-option").forEach(r=>{r.addEventListener("click",()=>{var b,q;const h=parseInt(r.dataset.wid||"0");p.selectWorkspace(h),(b=document.getElementById("ws-dropdown"))==null||b.classList.remove("open"),(q=document.getElementById("ws-backdrop"))==null||q.classList.remove("open")})}));const s=document.getElementById("user-name-display"),n=document.getElementById("user-fullname"),o=document.getElementById("user-avatar"),a=document.getElementById("user-avatar-lg");if(k.user){const r=k.user.username,h=r.charAt(0).toUpperCase();s&&(s.textContent=r),n&&(n.textContent=r),o&&(o.textContent=h),a&&(a.textContent=h)}const i=Object.values(y.sessions).filter(r=>r.status==="active").length,c=document.getElementById("nav-active-count");c&&(c.textContent=`${i} active`);const l=document.getElementById("sess-badge");l&&(l.textContent=String(Object.keys(y.sessions).length))}function Y(e){const t=document.getElementById("status-dot"),s=document.getElementById("nav-addr");t&&(t.classList.remove("offline"),e==="connected"?t.style.background="":e==="connecting"?t.style.background="var(--warning)":t.classList.add("offline")),s&&(s.textContent=e==="connected"?"daemon 127.0.0.1:9101":"daemon reconnecting…")}function ee(){const e=document.getElementById("filter-group");if(!e)return;const t=y.statusCounts(),s=Object.values(y.sessions).length,n=["all",...ae].map(o=>{const a=o==="all"?s:t[o]??0;return o!=="all"&&a===0&&y.currentFilter!==o?"":`<button class="filter-pill ${y.currentFilter===o?"active":""}" data-filter="${o}">
      ${o==="all"?"All":o}<span class="count">${a}</span>
    </button>`}).join("");e.innerHTML=n,e.querySelectorAll("[data-filter]").forEach(o=>{o.addEventListener("click",()=>{const a=o.dataset.filter;e.querySelectorAll(".filter-pill").forEach(i=>i.classList.remove("active")),o.classList.add("active"),y.setFilter(a)})})}function H(){var l,m;if(ye!=="dashboard")return;const e=document.getElementById("stats-row");if(!e)return;const t=Object.values(y.sessions),s=t.filter(d=>d.status==="active").length,n=t.reduce((d,r)=>d+(r.turn_count||0),0),o=((m=(l=p.tree)==null?void 0:l.workspaces)==null?void 0:m.reduce((d,r)=>{var h;return d+(((h=r.projects)==null?void 0:h.length)||0)},0))??0,a=t.filter(d=>d.cpu_percent).reduce((d,r)=>d+(r.cpu_percent||0),0)/Math.max(1,t.filter(d=>d.cpu_percent).length);e.innerHTML=`
    <div class="stat-card"><div class="stat-label">Active Sessions</div><div class="stat-value">${s}</div></div>
    <div class="stat-card"><div class="stat-label">Total Turns</div><div class="stat-value">${n}</div></div>
    <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value">${o}</div></div>
    <div class="stat-card"><div class="stat-label">Avg CPU</div><div class="stat-value">${a.toFixed(1)}%</div></div>`;const i=document.getElementById("recent-activity");if(!i)return;const c=[...t].sort((d,r)=>r.last_event_time_ms-d.last_event_time_ms).slice(0,6);if(c.length===0){i.innerHTML='<div class="empty-state"><p>No recent activity</p></div>';return}i.innerHTML=c.map(d=>{const r=d.status==="active"?"var(--success)":d.status==="idle"?"var(--warning)":d.status==="stopped"?"var(--text-disabled)":"var(--danger)",h=d.status==="active"?"box-shadow:0 0 6px var(--success-glow)":"";return`<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);background:var(--bg-raised);border:1px solid var(--border-hairline);border-radius:var(--radius-md);margin-bottom:var(--space-2)">
      <span style="width:8px;height:8px;border-radius:50%;background:${r};flex-shrink:0;${h}"></span>
      <span style="font-size:var(--text-sm);color:var(--text-primary);flex:1"><strong>${D(d.agent_type)}</strong> · ${D(d.session_title||d.agent_session_id)}${d.turn_count?" — Turn "+d.turn_count:""}</span>
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);font-family:var(--font-mono)">${Mt(d.last_event_time_ms)}</span>
    </div>`}).join("")}function D(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Mt(e){if(!e)return"";const t=Date.now()-e;return t<0?"":t<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?`${Math.floor(t/36e5)}h ago`:`${Math.floor(t/864e5)}d ago`}k.subscribe(()=>{k.authed&&!w?(ve(),$()):!k.authed&&w&&(w.close(),w=null)});Lt();oe();ne(()=>{k.authed&&(C(),ve(),$())});
