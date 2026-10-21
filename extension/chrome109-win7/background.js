(function () {
  'use strict';
  var API = typeof browser !== 'undefined' ? browser : chrome;
  var isFirefox = typeof browser !== 'undefined';
  var parseJobs = Object.create(null);
  var parseJobsByRequest = Object.create(null);
  var internalParseSequence = 0;
  var runningTasks = Object.create(null);
  var settingsKey = 'rz_settings_v1';
  var dbKey = 'rz_movies_v1';
  var GENRE = { film:'1', series:'2', cartoon:'3', anime:'82' };
  var USED_KEY = 'rz_used_v1';
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
      var job=parseJobs[tabId];
      if(job){
        delete parseJobs[tabId];
        removeTab(tabId);
        var error=e&&e.message?e.message:'Не удалось внедрить парсер.';
        settleParseRequest(job.requestId,new Error(error));
        send({type:'REZKERY_PARSE_ERROR',requestId:job.requestId,error:error});
      }
    });
  });
  API.tabs.onRemoved.addListener(function(tabId){
    if(parseJobs[tabId]) {
      var job=parseJobs[tabId];
      delete parseJobs[tabId];
      var error='Временная вкладка была закрыта.';
      settleParseRequest(job.requestId,new Error(error));
      send({type:'REZKERY_PARSE_ERROR',requestId:job.requestId,error:error});
    }
  });

  API.runtime.onMessage.addListener(function(message, sender) {
    if (!message) return;
    if (message.type === 'REZKERY_PARSE_URL') {
      return startParse(message.requestId, message.url);
    }
    if (message.type === 'REZKERY_PAGE_PARSED' && sender.tab) {
      var job=parseJobs[sender.tab.id];
      if(job){
        delete parseJobs[sender.tab.id];
        removeTab(sender.tab.id);
        settleParseRequest(job.requestId,null,message.result);
        send({type:'REZKERY_PARSE_RESULT',requestId:job.requestId,result:message.result});
      }
    }
    if (message.type === 'REZKERY_RUN_RANDOM') {
      var taskId=message.taskId || ('t'+Date.now());
      runRandomTask(taskId,message).catch(function(e){send({type:'REZKERY_TASK_RESULT',taskId:taskId,ok:false,error:e.message||'Ошибка.'});});
      return true;
    }
  });

  function settleParseRequest(requestId,error,result) {
    var pending=parseJobsByRequest[requestId];
    if(!pending)return false;
    delete parseJobsByRequest[requestId];
    if(pending.timer)clearTimeout(pending.timer);
    if(error)pending.reject(error);
    else pending.resolve(result);
    return true;
  }

  function parseInternal(url) {
    var requestId='internal-'+Date.now()+'-'+(++internalParseSequence);
    return new Promise(function(resolve,reject){
      var timer=setTimeout(function(){
        var pending=parseJobsByRequest[requestId];
        if(pending&&pending.tabId!=null){
          delete parseJobs[pending.tabId];
          removeTab(pending.tabId);
        }
        settleParseRequest(requestId,new Error('Не дождался ответа парсера страницы за 45 секунд.'));
      },45000);
      parseJobsByRequest[requestId]={resolve:resolve,reject:reject,timer:timer,tabId:null};
      startParse(requestId,url);
    });
  }

  function startParse(requestId,url) {
    return createTab('about:blank',false).then(function(tab){
      parseJobs[tab.id]={requestId:requestId};
      var pending=parseJobsByRequest[requestId];
      if(pending)pending.tabId=tab.id;
      return updateTab(tab.id,url);
    }).catch(function(e){
      var error=e&&e.message?e.message:'Не удалось открыть страницу.';
      settleParseRequest(requestId,new Error(error));
      send({type:'REZKERY_PARSE_ERROR',requestId:requestId,error:error});
    });
  }

  function getSettings(){ return storageGet(settingsKey).then(function(s){ s=s||{}; return {domain:s.domain||'https://rezkery.com',pageCountOverride:Math.max(0,Math.min(100000,parseInt(s.pageCountOverride,10)||0))}; }); }
  function genre(filter){ return GENRE[filter]||''; }
  function pageUrl(origin,scope,year,page,filter){
    var g=genre(filter), q=g?'?filter=last&genre='+g:'';
    if(scope==='year'){
      var host=new URL(origin).hostname.toLowerCase();
      var legacyYearRoutes=/(^|\.)rezkery\.com$/.test(host);
      var path=!legacyYearRoutes&&filter==='film'?'/films/best/foreign/'+year:
        !legacyYearRoutes&&filter==='series'?'/series/best/'+year:'/year/'+year;
      var yearUrl=origin+path+(page>1?'/page/'+page:'')+'/';
      var yearGenre=legacyYearRoutes||(filter!=='all'&&filter!=='film'&&filter!=='series')?g:'';
      return yearUrl+(yearGenre?'?filter=last&genre='+yearGenre:'');
    }
    return origin+(page>1?'/page/'+page+'/':'/')+q;
  }
  function norm(u){try{var x=new URL(u);x.hash='';return x.href.replace(/\/+$/,'/');}catch(e){return String(u||'');}}
  function movieKey(u){try{var path=new URL(u,'https://rezkery.com').pathname.replace(/\/{2,}/g,'/').replace(/\/+$/,'');return path||'/';}catch(e){return String(u||'').trim().replace(/[?#].*$/,'').replace(/\/+$/,'')||'/';}}
  function mergeMovie(a,b){var out={};Object.keys(a||{}).forEach(function(k){out[k]=a[k];});['title','year','poster','type','typeLabel','sourcePage'].forEach(function(k){if((!out[k]||out[k]==='Без названия'||(k==='type'&&out[k]==='other'))&&b&&b[k])out[k]=b[k];});out.id=movieKey(out.url);return out;}
  function rand(n){return Math.floor(Math.random()*n);}
  function dbLoad(){return storageGet(dbKey).then(function(x){var source=Array.isArray(x)?x:[],map=Object.create(null),changed=false;source.forEach(function(m){if(!m||!m.url)return;var k=movieKey(m.url);if(!k||k==='/')return;var item={};Object.keys(m).forEach(function(key){item[key]=m[key];});item.id=k;if(map[k]){map[k]=mergeMovie(map[k],item);changed=true;}else map[k]=item;if(m.id!==k)changed=true;});var db=Object.keys(map).map(function(k){return map[k];});if(db.length!==source.length)changed=true;return changed?dbSave(db).then(function(){return db;}):db;});}
  function dbSave(db){var o={};o[dbKey]=db;return storageSet(o);}
  function usedLoad(){return storageGet(USED_KEY).then(function(x){return Array.isArray(x)?Array.from(new Set(x.map(movieKey).filter(Boolean))):[];});}
  function usedSave(urls){var o={};o[USED_KEY]=Array.from(new Set((urls||[]).map(movieKey).filter(Boolean)));return storageSet(o);}
  function addUnique(movies){return dbLoad().then(function(db){var map=Object.create(null);db.forEach(function(m){map[movieKey(m.url)]=m;});var added=[];movies.forEach(function(m){var u=norm(m.url),k=movieKey(u);if(!u||!k||k==='/')return;var item={};Object.keys(m||{}).forEach(function(key){item[key]=m[key];});item.url=u;item.id=k;if(map[k]){var merged=mergeMovie(map[k],item),index=db.indexOf(map[k]);if(index>=0)db[index]=merged;map[k]=merged;return;}item.addedAt=item.addedAt||new Date().toISOString();db.push(item);map[k]=item;added.push(item);});return dbSave(db).then(function(){return {db:db,added:added};});});}
    function taskProgress(taskId, phase, detail, done, total) {
    send({type:'REZKERY_TASK_PROGRESS',taskId:taskId,progress:{
      phase:phase,detail:detail||'',done:Number(done)||0,total:Number(total)||0
    }});
  }

  function pageCount(origin,scope,year,filter,override,taskId,count){
    if(scope==='catalog'&&override>0){
      taskProgress(taskId,'Использую заданное число страниц','В настройках задано '+override+' страниц каталога.',0,count);
      return Promise.resolve(Math.min(100000,override));
    }
    taskProgress(taskId,'Определяю количество страниц','Читаю пагинацию выбранного каталога.',0,count);
    var first=pageUrl(origin,scope,year,1,filter);
    return parseInternal(first).then(function(r){
      if(!r||!Array.isArray(r.cards)||!r.cards.length) throw new Error('Не удалось прочитать карточки каталога. Проверьте доступ к выбранному домену.');
      var p=r.pagination||{}, max=Number(p.max)||1;
      if(!p.exact||max<1){
        var label=scope==='year'?'за выбранный год':'в каталоге';
        throw new Error('Не удалось определить последнюю страницу '+label+'. Проверьте домен или укажите число страниц каталога в настройках.');
      }
      return max;
    });
  }  function rememberDetectedPageCount(origin,scope,year,filter,pages){
    var key='rz_page_cache_v1';
    return storageGet(key).catch(function(){return null;}).then(function(cache){
      cache=cache||{};
      var cacheOrigin=origin;
      try{cacheOrigin=new URL(origin).origin;}catch(e){}
      if(cache.domain!==cacheOrigin) cache={domain:cacheOrigin,catalog:{},year:{}};
      cache.catalog=cache.catalog||{};cache.year=cache.year||{};
      if(scope==='year') cache.year[String(Number(year))+':'+filter]=pages;
      else cache.catalog[filter]=pages;
      var value={};value[key]=cache;return storageSet(value);
    }).catch(function(){});
  }

  function runRandomTask(taskId,msg){
    if(runningTasks[taskId]) return Promise.resolve(); runningTasks[taskId]=true;
    var count=Math.max(1,Math.min(30,Number(msg.count)||1)),filter=msg.filter||'all',scope=msg.scope||'catalog',year=Number(msg.year)||null;
    taskProgress(taskId,'Запускаю подбор карточек','Подготавливаю запрос к каталогу.',0,count);
    return getSettings().then(function(settings){
      var origin=settings.domain;
      return pageCount(origin,scope,year,filter,settings.pageCountOverride,taskId,count).then(function(pages){
        return rememberDetectedPageCount(origin,scope,year,filter,pages).then(function(){
          try{send({type:'REZKERY_PAGE_COUNT_DETECTED',scope:scope,year:year,filter:filter,pages:pages});}catch(e){}
          taskProgress(taskId,'Пагинация определена','Всего страниц: '+pages+'. Подбираю карточки без повторов.',0,count);
          return Promise.all([dbLoad(),usedLoad()]).then(function(values){
          var db=values[0],used=Object.create(null);db.forEach(function(m){used[movieKey(m.url)]=1;});values[1].forEach(function(u){used[movieKey(u)]=1;});var picks=[];
          function one(attempt){
            if(picks.length>=count)return Promise.resolve();
            if(attempt>80)return Promise.reject(new Error('Не удалось найти достаточно новых карточек. Возможно, выбранный тип уже почти весь есть в базе.'));
            var p=rand(pages)+1;
            taskProgress(taskId,'Подбираю карточку '+(picks.length+1)+' из '+count,'Просматриваю страницу '+p+' из '+pages+'.',picks.length,count);
            return parseInternal(pageUrl(origin,scope,year,p,filter)).then(function(r){
              var cards=(r&&r.cards)||[];cards=cards.filter(function(m){return m.url&&!used[movieKey(m.url)]&&(filter==='all'||m.type===filter);});
              if(!cards.length){
                taskProgress(taskId,'Ищу свободную карточку','На странице '+p+' новых карточек нет; выбираю другую страницу.',picks.length,count);
                return one(attempt+1);
              }
              var m=cards[rand(cards.length)];used[movieKey(m.url)]=1;picks.push(m);return one(0);
            });
          }
          return one(0).then(function(){
            taskProgress(taskId,'Сохраняю выбранные карточки','Добавляю карточки в локальную базу и отмечаю их как уже выбранные.',picks.length,count);
            return addUnique(picks).then(function(){picks.forEach(function(m){used[movieKey(m.url)]=1;});return usedSave(Object.keys(used)).then(function(){return Promise.all(picks.map(function(m){return createTab(m.url,false);})).then(function(){return picks;});});});
          });
          });
        });
      });
    }).then(function(picks){send({type:'REZKERY_TASK_RESULT',taskId:taskId,ok:true,picks:picks});}).catch(function(e){send({type:'REZKERY_TASK_RESULT',taskId:taskId,ok:false,error:e.message||'Ошибка.'});}).then(function(){delete runningTasks[taskId];});
  }
})();
