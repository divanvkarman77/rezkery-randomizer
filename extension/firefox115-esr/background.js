(function () {
  'use strict';
  var API = typeof browser !== 'undefined' ? browser : chrome;
  var isFirefox = typeof browser !== 'undefined';
  var parseJobs = Object.create(null);
  var runningTasks = Object.create(null);
  var settingsKey = 'rz_settings_v1';
  var dbKey = 'rz_movies_v1';
  var GENRE = { film:'1', series:'2', cartoon:'3', anime:'82' };
  var FALLBACK = { all:2530, film:1731, series:520, cartoon:173, anime:107 };
  var LABEL = {all:'Все',film:'Фильмы',series:'Сериалы',cartoon:'Мультфильмы',anime:'Аниме'};

  function storageGet(key) {
    if (isFirefox) return API.storage.local.get(key).then(function(x){return x[key];});
    return new Promise(function(resolve,reject){API.storage.local.get(key,function(x){if(chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(x[key]);});});
  }
  function storageSet(obj) {
    if (isFirefox) return API.storage.local.set(obj);
    return new Promise(function(resolve,reject){API.storage.local.set(obj,function(){if(chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();});});
  }
  function createTab(url, active) {
    if (isFirefox) return API.tabs.create({url:url,active:active!==false});
    return new Promise(function(resolve,reject){API.tabs.create({url:url,active:active!==false},function(tab){if(chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(tab);});});
  }
  function updateTab(id,url) {
    if (isFirefox) return API.tabs.update(id,{url:url,active:false});
    return new Promise(function(resolve,reject){API.tabs.update(id,{url:url,active:false},function(tab){if(chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(tab);});});
  }
  function removeTab(id) { try { var p=API.tabs.remove(id); return p&&p.catch?p.catch(function(){}):Promise.resolve(); } catch(e){return Promise.resolve();} }
  function executeParser(tabId) {
    if (API.scripting && API.scripting.executeScript) {
      return API.scripting.executeScript({target:{tabId:tabId},files:['content.js']});
    }
    return Promise.reject(new Error('Scripting API недоступен в этой версии браузера.'));
  }
  function send(msg) { try { var p=API.runtime.sendMessage(msg); if(p&&p.catch)p.catch(function(){}); } catch(e){} }

  API.tabs.onUpdated.addListener(function(tabId, changeInfo) {
    if (changeInfo.status !== 'complete' || !parseJobs[tabId]) return;
    executeParser(tabId).catch(function(e){
      var job=parseJobs[tabId]; if(job){ delete parseJobs[tabId]; removeTab(tabId); send({type:'REZKERY_PARSE_ERROR',requestId:job.requestId,error:e.message||'Не удалось внедрить парсер.'}); }
    });
  });
  API.tabs.onRemoved.addListener(function(tabId){
    if(parseJobs[tabId]) { var job=parseJobs[tabId]; delete parseJobs[tabId]; send({type:'REZKERY_PARSE_ERROR',requestId:job.requestId,error:'Временная вкладка была закрыта.'}); }
  });

  API.runtime.onMessage.addListener(function(message, sender) {
    if (!message) return;
    if (message.type === 'REZKERY_PARSE_URL') {
      return startParse(message.requestId, message.url);
    }
    if (message.type === 'REZKERY_PAGE_PARSED' && sender.tab) {
      var job=parseJobs[sender.tab.id];
      if(job){
        if (parseJobsByRequest[job.requestId]) parseJobsByRequest[job.requestId].resolve(message.result);
        delete parseJobs[sender.tab.id];
        removeTab(sender.tab.id);
        send({type:'REZKERY_PARSE_RESULT',requestId:job.requestId,result:message.result});
      }
    }
    if (message.type === 'REZKERY_RUN_RANDOM') {
      var taskId=message.taskId || ('t'+Date.now());
      runRandomTask(taskId,message).catch(function(e){send({type:'REZKERY_TASK_RESULT',taskId:taskId,ok:false,error:e.message||'Ошибка.'});});
      return true;
    }
  });

  function startParse(requestId,url) {
    return createTab('about:blank',false).then(function(tab){
      parseJobs[tab.id]={requestId:requestId};
      return updateTab(tab.id,url);
    }).catch(function(e){send({type:'REZKERY_PARSE_ERROR',requestId:requestId,error:e.message||'Не удалось открыть страницу.'});});
  }

  function getSettings(){ return storageGet(settingsKey).then(function(s){ return (s&&s.domain)||'https://rezkery.com'; }); }
  function genre(filter){ return GENRE[filter]||''; }
  function pageUrl(origin,scope,year,page,filter){
    var g=genre(filter), q=g?'?filter=last&genre='+g:'';
    if(scope==='year') return origin+'/year/'+year+(page>1?'/page/'+page+'/':'/')+q;
    return origin+(page>1?'/page/'+page+'/':'/')+q;
  }
  function norm(u){try{var x=new URL(u);x.hash='';return x.href.replace(/\/+$/,'/');}catch(e){return String(u||'');}}
  function rand(n){return Math.floor(Math.random()*n);}
  function dbLoad(){return storageGet(dbKey).then(function(x){return Array.isArray(x)?x:[];});}
  function dbSave(db){var o={};o[dbKey]=db;return storageSet(o);}
  function addUnique(movies){return dbLoad().then(function(db){var map=Object.create(null);db.forEach(function(m){map[norm(m.url)]=1;});var added=[];movies.forEach(function(m){var u=norm(m.url);if(!u||map[u])return;m.url=u;m.id=u;m.addedAt=new Date().toISOString();db.push(m);map[u]=1;added.push(m);});return dbSave(db).then(function(){return {db:db,added:added};});});}
  function pageCount(origin,scope,year,filter){
    var first=pageUrl(origin,scope,year,1,filter), seen=Object.create(null);
    function numberOf(url){var m=String(url||'').match(/\/page\/(\d+)\/?(?:\?.*)?$/);return m?Number(m[1]):1;}
    function walk(url,r,guard){
      var p=r&&r.pagination||{}, max=Math.max(Number(p.max)||1,Number(p.last?numberOf(p.last):1)||1), current=Number(p.current||numberOf(url)||1)||1;
      if(max>current)return Promise.resolve(max);
      var next=p.next&&/^https?:\/\//i.test(p.next)?p.next:'';
      if(next&&guard<120&&!seen[next]&&next!==url){seen[next]=1;return parseInternal(next).then(function(nr){return walk(next,nr,guard+1);});}
      return Promise.resolve(max);
    }
    return parseInternal(first).then(function(r){var max=Number(r&&r.pagination&&r.pagination.max)||1;if(scope==='catalog'&&max<2)return FALLBACK[filter]||1;seen[first]=1;return walk(first,r,0);});
  }
  function parseInternal(url){
    var id='bg'+Date.now()+'_'+Math.random().toString(36).slice(2);
    return new Promise(function(resolve,reject){
      var timer=setTimeout(function(){delete parseJobsByRequest[id];reject(new Error('Тайм-аут чтения страницы.'));},30000);
      parseJobsByRequest[id]={resolve:function(r){clearTimeout(timer);delete parseJobsByRequest[id];resolve(r);},reject:function(e){clearTimeout(timer);delete parseJobsByRequest[id];reject(e);}};
      startParse(id,url);
    });
  }
  var parseJobsByRequest=Object.create(null);
  function runRandomTask(taskId,msg){
    if(runningTasks[taskId]) return Promise.resolve(); runningTasks[taskId]=true;
    var count=Math.max(1,Math.min(30,Number(msg.count)||1)),filter=msg.filter||'all',scope=msg.scope||'catalog',year=Number(msg.year)||null;
    return getSettings().then(function(origin){
      return pageCount(origin,scope,year,filter).then(function(pages){
        return dbLoad().then(function(db){
          var used=Object.create(null);db.forEach(function(m){used[norm(m.url)]=1;});var picks=[];
          function one(attempt){
            if(picks.length>=count)return Promise.resolve();
            if(attempt>80)return Promise.reject(new Error('Не удалось найти достаточно новых карточек. Возможно, выбранный тип уже почти весь есть в базе.'));
            var p=rand(pages)+1;
            return parseInternal(pageUrl(origin,scope,year,p,filter)).then(function(r){
              var cards=(r&&r.cards)||[];cards=cards.filter(function(m){return m.url&&!used[norm(m.url)]&&(filter==='all'||m.type===filter);});
              if(!cards.length)return one(attempt+1);
              var m=cards[rand(cards.length)];used[norm(m.url)]=1;picks.push(m);return one(0);
            });
          }
          return one(0).then(function(){return addUnique(picks).then(function(){return Promise.all(picks.map(function(m){return createTab(m.url,false);})).then(function(){return picks;});});});
        });
      });
    }).then(function(picks){send({type:'REZKERY_TASK_RESULT',taskId:taskId,ok:true,picks:picks});}).catch(function(e){send({type:'REZKERY_TASK_RESULT',taskId:taskId,ok:false,error:e.message||'Ошибка.'});}).then(function(){delete runningTasks[taskId];});
  }
})();
