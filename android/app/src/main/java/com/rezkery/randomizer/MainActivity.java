package com.rezkery.randomizer;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.CookieManager;
import android.widget.*;
import android.view.View;
import android.view.WindowManager;
import org.json.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class MainActivity extends Activity {
    EditText domain, year, count, simpleCount;
    CheckBox avoidSameYear;
    AutoCompleteTextView yearDropdown;
    Button yearMinus, yearPlus, yearDropdownButton, hdrezkaSyncButton, settingsButton;
    LinearLayout advancedPanel;
    TextView title;
    LinearLayout settingsPanel;
    Spinner requestInterval, protectionCooldown;
    String[] intervalOptions={"1 секунда","2 секунды","3 секунды","5 секунд"};
    int[] intervalSeconds={1,2,3,5};
    String[] cooldownOptions={"1 минута","3 минуты","5 минут","10 минут","15 минут","30 минут"};
    int[] cooldownMinutes={1,3,5,10,15,30};
    Spinner type, openMode;
    Button simpleModeButton, advancedModeButton;
    boolean simpleMode = true;
    TextView status, subtitle;
    WebView web;
    Button random, themeButton, databaseButton, exportJsonButton, importJsonButton,
            exportHtmlButton, importHtmlButton, driveExportButton, driveImportButton, githubButton;
    android.content.SharedPreferences prefs;
    String[] types={"Все вместе","Только фильмы","Только сериалы","Только мультфильмы","Только аниме"};
    String[] genres={"","1","2","3","82"};
    String[] openModes={"Открывать в браузере","Открывать в HDRezka App","Спрашивать каждый раз"};
    int pendingPage=-1;
    int pendingTotal=1, pendingChosen=0, pendingMax=1;
    int maxPageChecks=1;
    long batchToken=0, lastPageStarted=0;
    boolean randomInProgress=false;
    String batchNotice="";
    boolean batchSimpleMode=true, batchAvoidSameYear=false;
    String batchOrigin="https://rezkery.com", batchYear="";
    int batchType=0;
    HashSet<String> batchYears=new HashSet<>();

    ArrayList<Integer> pendingPages=new ArrayList<>();
    ArrayList<String> pendingUrls=new ArrayList<>();
    HashSet<String> pendingBatchUrls=new HashSet<>();
    HashSet<Integer> attemptedPages=new HashSet<>();
    HashMap<String,String> pendingTitles=new HashMap<>();
    static final int PICK_IMPORT=101, PICK_EXPORT_JSON=102, PICK_EXPORT_HTML=103;
    JSONArray library = new JSONArray();
    boolean lightTheme;

    @Override public void onCreate(Bundle b){
        super.onCreate(b); setContentView(R.layout.activity_main);
        prefs=getSharedPreferences("rzk",0);
        domain=findViewById(R.id.domain); year=findViewById(R.id.year); count=findViewById(R.id.count); simpleCount=findViewById(R.id.simpleCount); avoidSameYear=findViewById(R.id.avoidSameYear); type=findViewById(R.id.type);
        status=findViewById(R.id.status); subtitle=findViewById(R.id.subtitle); title=findViewById(R.id.title); web=findViewById(R.id.web);
        yearDropdown=findViewById(R.id.year); yearMinus=findViewById(R.id.yearMinus); yearPlus=findViewById(R.id.yearPlus); yearDropdownButton=findViewById(R.id.yearDropdownButton);
        hdrezkaSyncButton=findViewById(R.id.hdrezkaSync); settingsButton=findViewById(R.id.settings);
        settingsPanel=findViewById(R.id.settingsPanel); advancedPanel=findViewById(R.id.advancedPanel); requestInterval=findViewById(R.id.requestInterval); protectionCooldown=findViewById(R.id.protectionCooldown);
        setupTimeoutControls();
        openMode=findViewById(R.id.openMode);
        simpleModeButton=findViewById(R.id.simpleMode); advancedModeButton=findViewById(R.id.advancedMode);
        simpleMode=prefs.getBoolean("simpleMode",true);
        random=findViewById(R.id.random); themeButton=findViewById(R.id.theme);
        databaseButton=findViewById(R.id.database); exportJsonButton=findViewById(R.id.exportJson);
        importJsonButton=findViewById(R.id.importJson); exportHtmlButton=findViewById(R.id.exportHtml);
        importHtmlButton=findViewById(R.id.importHtml); driveExportButton=findViewById(R.id.driveExport);
        driveImportButton=findViewById(R.id.driveImport); githubButton=findViewById(R.id.githubSync);
        domain.setText(prefs.getString("domainAdvanced",prefs.getString("domain","https://rezkery.com")));
        simpleCount.setText(prefs.getString("simpleCount","1"));
        avoidSameYear.setChecked(prefs.getBoolean("avoidSameYear",false));
        avoidSameYear.setOnCheckedChangeListener((button,checked)->prefs.edit().putBoolean("avoidSameYear",checked).apply());
        year.setText(prefs.getString("yearAdvanced","")); count.setText(prefs.getString("countAdvanced",prefs.getString("pickCount","1")));
        lightTheme=prefs.getBoolean("lightTheme",false);
        type.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,types) {{
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        }});
        openMode.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,openModes) {{ setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); }});
        openMode.setSelection(Math.max(0,Math.min(prefs.getInt("openMode",0),openModes.length-1)));
        type.setSelection(Math.max(0,Math.min(prefs.getInt("categoryAdvanced",0),types.length-1)));
        ArrayList<String> yearOptions=new ArrayList<>(); for(int y=maximumSelectableYear();y>=1900;y--)yearOptions.add(String.valueOf(y));
        ArrayAdapter<String> yearAdapter=new ArrayAdapter<String>(this,android.R.layout.simple_dropdown_item_1line,yearOptions);
        yearDropdown.setAdapter(yearAdapter); yearDropdown.setThreshold(0);
        yearDropdown.setOnFocusChangeListener((v,hasFocus)->{if(hasFocus){yearDropdown.post(()->yearDropdown.showDropDown());}});
        yearDropdown.setOnClickListener(v->yearDropdown.showDropDown());
        yearDropdownButton.setOnClickListener(v->{yearDropdown.requestFocus();yearDropdown.showDropDown();});
        yearMinus.setOnClickListener(v->adjustYear(-1)); yearPlus.setOnClickListener(v->adjustYear(1));
        domain.addTextChangedListener(simpleWatcher("domainAdvanced")); year.addTextChangedListener(simpleWatcher("yearAdvanced")); count.addTextChangedListener(simpleWatcher("countAdvanced")); simpleCount.addTextChangedListener(simpleWatcher("simpleCount"));
        type.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int pos,long id){prefs.edit().putInt("categoryAdvanced",pos).apply();}public void onNothingSelected(android.widget.AdapterView<?> p){}});
        openMode.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int pos,long id){prefs.edit().putInt("openMode",pos).apply();}
            public void onNothingSelected(android.widget.AdapterView<?> p){}
        });
        loadLibrary(); applyTheme();
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String u){ v.evaluateJavascript(parserScript(), value -> handleParsed(value)); }
        });
        random.setOnClickListener(v->startRandom());
        simpleModeButton.setOnClickListener(v->switchMode(true));
        advancedModeButton.setOnClickListener(v->switchMode(false));
        themeButton.setOnClickListener(v->{lightTheme=!lightTheme;prefs.edit().putBoolean("lightTheme",lightTheme).apply();applyTheme();});
        databaseButton.setOnClickListener(v->showDatabase());
        exportJsonButton.setOnClickListener(v->chooseExport(PICK_EXPORT_JSON,"rezkery-database.json","application/json"));
        importJsonButton.setOnClickListener(v->chooseImport("application/json"));
        exportHtmlButton.setOnClickListener(v->chooseExport(PICK_EXPORT_HTML,"rezkery-database.html","text/html"));
        importHtmlButton.setOnClickListener(v->chooseImport("text/*"));
        driveExportButton.setOnClickListener(v->chooseExport(PICK_EXPORT_JSON,"rezkery-drive-backup.json","application/json"));
        driveImportButton.setOnClickListener(v->chooseImport("application/json"));
        githubButton.setOnClickListener(v->githubDialog());
        hdrezkaSyncButton.setOnClickListener(v->hdrezkaSyncDialog());
        settingsButton.setOnClickListener(v->openSettingsWindow());
        applyModeVisibility();
        setStatus("База сохранена локально. Повторно выбранные фильмы пропускаются.");
    }

    void applyTheme(){
        int selectedType=type.getSelectedItemPosition();
        int selectedOpenMode=openMode.getSelectedItemPosition();
        int selectedInterval=requestInterval.getSelectedItemPosition(), selectedCooldown=protectionCooldown.getSelectedItemPosition();
        int bg=lightTheme?Color.rgb(247,249,252):Color.rgb(17,19,23);
        int fg=lightTheme?Color.rgb(24,29,38):Color.WHITE;
        int muted=lightTheme?Color.rgb(76,86,102):Color.rgb(174,181,193);
        LinearLayout root=findViewById(R.id.root);
        root.setBackgroundColor(bg); tintLabels(root,muted);
        title.setTextColor(fg); subtitle.setTextColor(muted); status.setTextColor(muted);
        domain.setTextColor(fg); year.setTextColor(fg);
        domain.setHintTextColor(muted); year.setHintTextColor(muted);
        int[][] states=new int[][]{new int[]{android.R.attr.state_enabled},new int[]{}};
        int[] colors=new int[]{fg,fg};
        type.setPopupBackgroundDrawable(new android.graphics.drawable.ColorDrawable(lightTheme?Color.WHITE:Color.rgb(38,42,50)));
        openMode.setPopupBackgroundDrawable(new android.graphics.drawable.ColorDrawable(lightTheme?Color.WHITE:Color.rgb(38,42,50)));
        openMode.setBackgroundTintList(android.content.res.ColorStateList.valueOf(lightTheme?Color.rgb(70,80,96):Color.rgb(190,198,210)));
        type.setBackgroundTintList(android.content.res.ColorStateList.valueOf(lightTheme?Color.rgb(70,80,96):Color.rgb(190,198,210)));
        for(Button b:new Button[]{random,themeButton,databaseButton,exportJsonButton,importJsonButton,exportHtmlButton,importHtmlButton,driveExportButton,driveImportButton,githubButton,hdrezkaSyncButton,yearMinus,yearPlus,yearDropdownButton,settingsButton,simpleModeButton,advancedModeButton}){
            b.setTextColor(lightTheme?Color.WHITE:Color.rgb(20,22,26));
            b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(lightTheme?Color.rgb(42,91,170):Color.rgb(224,228,234)));
        }
        themeButton.setText(lightTheme?"☾":"☀");
        themeButton.setContentDescription(lightTheme?"Включить тёмную тему":"Включить светлую тему");
        getWindow().setStatusBarColor(bg); getWindow().setNavigationBarColor(bg);
        getWindow().getDecorView().setSystemUiVisibility(lightTheme?ViewFlags.LIGHT_STATUS:0);
        // Force readable dropdown text; the adapter is recreated when theme changes.
        ArrayList<String> yearOptions=new ArrayList<>();for(int y=maximumSelectableYear();y>=1900;y--)yearOptions.add(String.valueOf(y));
        yearDropdown.setDropDownBackgroundDrawable(new android.graphics.drawable.ColorDrawable(lightTheme?Color.WHITE:Color.rgb(38,42,50)));
        yearDropdown.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_dropdown_item_1line,yearOptions){
            @Override public android.view.View getView(int position,android.view.View convert,android.view.ViewGroup parent){
                TextView tv=(TextView)super.getView(position,convert,parent);tv.setTextColor(fg);tv.setPadding(18,12,18,12);tv.setBackgroundColor(lightTheme?Color.WHITE:Color.rgb(38,42,50));return tv;
            }
            @Override public android.view.View getDropDownView(int position,android.view.View convert,android.view.ViewGroup parent){
                TextView tv=(TextView)super.getDropDownView(position,convert,parent);tv.setTextColor(fg);tv.setPadding(18,14,18,14);tv.setBackgroundColor(lightTheme?Color.WHITE:Color.rgb(38,42,50));return tv;
            }
        });
        type.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,types) {
            { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); }
            @Override public android.view.View getView(int position, android.view.View convert, android.view.ViewGroup parent) {
                TextView tv=(TextView)super.getView(position,convert,parent); tv.setTextColor(fg); tv.setPadding(12,8,12,8); return tv;
            }
            @Override public android.view.View getDropDownView(int position, android.view.View convert, android.view.ViewGroup parent) {
                TextView tv=(TextView)super.getDropDownView(position,convert,parent); tv.setTextColor(fg); tv.setBackgroundColor(lightTheme?Color.WHITE:Color.rgb(38,42,50)); tv.setPadding(18,18,18,18); return tv;
            }
        });
        type.setSelection(Math.max(0, Math.min(selectedType, types.length-1)));
        openMode.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,openModes) {
            { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); }
            @Override public android.view.View getView(int position, android.view.View convert, android.view.ViewGroup parent) {
                TextView tv=(TextView)super.getView(position,convert,parent); tv.setTextColor(fg); tv.setPadding(12,8,12,8); return tv;
            }
            @Override public android.view.View getDropDownView(int position, android.view.View convert, android.view.ViewGroup parent) {
                TextView tv=(TextView)super.getDropDownView(position,convert,parent); tv.setTextColor(fg); tv.setBackgroundColor(lightTheme?Color.WHITE:Color.rgb(38,42,50)); tv.setPadding(18,18,18,18); return tv;
            }
        });
        openMode.setSelection(Math.max(0, Math.min(selectedOpenMode, openModes.length-1)));
        styleChoiceSpinner(requestInterval,intervalOptions,selectedInterval,fg,lightTheme);
        styleChoiceSpinner(protectionCooldown,cooldownOptions,selectedCooldown,fg,lightTheme);
    }
    void tintLabels(android.view.ViewGroup group,int color){
        for(int i=0;i<group.getChildCount();i++){
            android.view.View child=group.getChildAt(i);
            if(child instanceof Button)continue;
            if(child instanceof EditText){((TextView)child).setTextColor(lightTheme?Color.rgb(24,29,38):Color.WHITE);continue;}
            if(child instanceof TextView)((TextView)child).setTextColor(color);
            if(child instanceof android.view.ViewGroup)tintLabels((android.view.ViewGroup)child,color);
        }
    }
    static class ViewFlags { static final int LIGHT_STATUS=0x00002000; }

    String origin(){
        String d=simpleMode?"https://rezkery.com":domain.getText().toString().trim();
        if(!d.matches("(?i)^https?://.*")) d="https://"+d;
        return d.replaceAll("/+$","");
    }
    String pageUrl(int page){
        boolean simple=randomInProgress?batchSimpleMode:simpleMode;
        String host=randomInProgress?batchOrigin:origin();
        String selectedYear=randomInProgress?batchYear:(simple?"":year.getText().toString().trim());
        int selectedType=randomInProgress?batchType:(simple?0:type.getSelectedItemPosition());
        String genre=genres[Math.max(0,Math.min(selectedType,genres.length-1))];
        String path=selectedYear.isEmpty()?host+(page>1?"/page/"+page+"/":"/"):
            host+"/year/"+selectedYear+(page>1?"/page/"+page+"/":"/");
        return path+(genre.isEmpty()?"":"?filter=last&genre="+genre);
    }
    void startRandom(){
        long protectionCooldown=prefs.getLong("protectionCooldownUntil",0L);
        if(System.currentTimeMillis()<protectionCooldown){
            long minutes=Math.max(1,(protectionCooldown-System.currentTimeMillis()+59999L)/60000L);
            new AlertDialog.Builder(this).setTitle("Пауза после проверки защиты")
                .setMessage("Подбор временно приостановлен ещё примерно на "+minutes+" мин. Если ты уже прошёл проверку в браузере, можно сделать один осторожный запрос для проверки.")
                .setNegativeButton("Подождать",null)
                .setPositiveButton("Я прошёл проверку — проверить один раз",(d,w)->{
                    prefs.edit().remove("protectionCooldownUntil").apply();
                    startRandom();
                }).show();
            return;
        }
        if(randomInProgress){setStatus("Подбор уже выполняется. Подожди завершения.");return;}
        batchSimpleMode=simpleMode;
        batchOrigin=origin();
        batchYear=simpleMode?"":year.getText().toString().trim();
        batchType=simpleMode?0:type.getSelectedItemPosition();
        if(!batchYear.isEmpty()&&!batchYear.matches("\\d{4}")){setStatus("Укажи год четырьмя цифрами, например 1998.");return;}
        if(!simpleMode)prefs.edit().putString("domainAdvanced",batchOrigin).putString("yearAdvanced",batchYear).putString("countAdvanced",count.getText().toString().trim()).putInt("categoryAdvanced",batchType).apply();
        try {
            int selected=simpleMode?Integer.parseInt(simpleCount.getText().toString().trim()):Integer.parseInt(count.getText().toString().trim());
            pendingTotal=Math.max(1,Math.min(30,selected));
        }catch(Exception e){pendingTotal=1;}
        batchAvoidSameYear=prefs.getBoolean("avoidSameYear",false)&&batchYear.isEmpty();
        pendingChosen=0; pendingUrls.clear(); pendingBatchUrls.clear(); pendingPages.clear(); attemptedPages.clear(); pendingTitles.clear(); pendingPage=-1;batchYears.clear();
        randomInProgress=true;batchNotice="";batchToken++;lastPageStarted=android.os.SystemClock.elapsedRealtime();
        setStatus("Проверяю каталог…"); web.loadUrl(pageUrl(1));
    }
    String parserScript(){
        return "(function(){var cards=[],seen={};var ns=document.querySelectorAll('.b-content__inline_item');"+
        "for(var i=0;i<ns.length;i++){var n=ns[i],a=n.querySelector('a[href]');if(!a)continue;var u=a.href;if(seen[u])continue;seen[u]=1;var l=n.querySelector('.b-content__inline_item-link'),years=(n.innerText||'').match(/(19|20|21)\\d{2}/g)||[],urlYears=u.match(/(19|20|21)\\d{2}/g)||[],ym=urlYears.length?urlYears[urlYears.length-1]:(years.length?years[years.length-1]:'');cards.push({url:u,title:(l?l.innerText:a.innerText||'Без названия').trim(),year:ym});}"+
        "var max=1,as=document.querySelectorAll('a[href]');for(var j=0;j<as.length;j++){var h=as[j].href,m=h.match(/\\/page\\/(\\d+)\\/?(?:\\?.*)?$/);if(m)max=Math.max(max,parseInt(m[1],10)||1);}"+
        "var title=document.title||'',body=document.body?(document.body.innerText||'').slice(0,4000):'',challenge=/anubis|cloudflare|cdn-cgi\\/challenge|challenge-platform|captcha|checking your browser|just a moment|провер(ка|ьте).*человек|подтвердите.*человек/i.test(location.href+' '+title+' '+body)||!!document.querySelector('#challenge-form,.cf-challenge,#anubis_challenge,[data-anubis]');"+
        "return JSON.stringify({cards:cards,max:max,challenge:challenge,title:title});})()";
    }
    void handleParsed(String value){
        try{
            String raw=value;
            if(raw.startsWith("\"") && raw.endsWith("\"")) raw=(String)new JSONTokener(raw).nextValue();
            JSONObject r=new JSONObject(raw); int max=Math.max(1,r.optInt("max",1)); JSONArray cards=r.optJSONArray("cards");
            if(r.optBoolean("challenge",false)){
                long cooldown=Math.max(1,prefs.getInt("protectionCooldownMinutes",15));
                batchNotice="Обнаружена проверка защиты сайта ("+r.optString("title","")+
                    "). Запросы остановлены. Повторный запрос будет доступен через "+cooldown+" мин.";
                prefs.edit().putLong("protectionCooldownUntil",System.currentTimeMillis()+cooldown*60L*1000L).apply();
                pendingPages.clear();finishBatch();return;
            }
            if(pendingPage==-1 && pendingChosen==0 && pendingUrls.isEmpty()){
                if(cards==null||cards.length()==0){
                    batchNotice="Сайт не вернул карточки каталога. Запросы остановлены, чтобы не нагружать сервер.";
                    pendingPages.clear();finishBatch();return;
                }
                pendingMax=Math.max(1,Math.min(max,10000));
                maxPageChecks=Math.min(pendingMax,Math.max(pendingTotal,Math.min(24,pendingTotal*3)));
                ArrayList<Integer> all=new ArrayList<>(); for(int p=1;p<=pendingMax;p++)all.add(p);
                Collections.shuffle(all);
                if(pendingTotal==1){
                    for(int p:all){if(p!=1){pendingPages.add(p);if(pendingPages.size()>=maxPageChecks-1)break;}}
                    pendingPage=1;attemptedPages.add(1);processBatchPage(cards);return;
                }
                for(int i=0;i<Math.min(maxPageChecks,all.size());i++)pendingPages.add(all.get(i));
                loadNextBatchPage(); return;
            }
            processBatchPage(cards);
        }catch(Exception e){
            setStatus("Ошибка чтения страницы: "+e.getMessage());
            randomInProgress=false;batchToken++;pendingPages.clear();
        }
    }
    void loadNextBatchPage(){
        if(pendingPages.isEmpty() || pendingChosen>=pendingTotal){finishBatch();return;}
        pendingPage=pendingPages.remove(0); attemptedPages.add(pendingPage);
        final int page=pendingPage;final long token=batchToken;
        setStatus("Выбираю карточку "+(pendingChosen+1)+" из "+pendingTotal+" — страница "+page+"…");
        long elapsed=android.os.SystemClock.elapsedRealtime()-lastPageStarted;
        long intervalMs=Math.max(1000L,prefs.getInt("requestIntervalSeconds",2)*1000L);
        long delay=Math.max(0L,intervalMs-elapsed);
        new android.os.Handler(getMainLooper()).postDelayed(()->{
            if(!randomInProgress||token!=batchToken||pendingPage!=page)return;
            lastPageStarted=android.os.SystemClock.elapsedRealtime();
            web.loadUrl(pageUrl(page));
        },delay);
    }
    void processBatchPage(JSONArray cards) throws Exception {
        HashSet<String> used=usedUrls(); used.addAll(pendingBatchUrls);
        ArrayList<JSONObject> candidates=new ArrayList<>(), sameYearCandidates=new ArrayList<>();
        if(cards!=null) for(int i=0;i<cards.length();i++){
            JSONObject x=cards.getJSONObject(i); String u=x.optString("url","");
            if(!u.isEmpty()&&!used.contains(u)){
                String cardYear=x.optString("year","");
                if(!batchAvoidSameYear||cardYear.isEmpty()||!batchYears.contains(cardYear))candidates.add(x);
                else sameYearCandidates.add(x);
            }
        }
        if(!candidates.isEmpty()){
            JSONObject pick=candidates.get(new Random().nextInt(candidates.size()));
            String u=pick.getString("url"), cardYear=pick.optString("year","");
            pendingBatchUrls.add(u); pendingUrls.add(u);pendingTitles.put(u,pick.optString("title",u));
            if(!cardYear.isEmpty())batchYears.add(cardYear);
            pendingChosen++;
        }
        if(!pendingPages.isEmpty() && pendingChosen<pendingTotal){loadNextBatchPage();return;}
        if(pendingUrls.size()<pendingTotal&&batchAvoidSameYear&&!sameYearCandidates.isEmpty()&&pendingPages.isEmpty()){
            batchNotice="На оставшихся проверенных страницах уже выбранные года повторялись — поэтому карточек получилось меньше количества в настройках.";
        }
        finishBatch();
    }
    void finishBatch(){
        int requested=pendingTotal;
        try{
            if(pendingUrls.isEmpty()){
                setStatus(batchNotice.isEmpty()?"Не удалось найти новые карточки на проверенных страницах. Попробуй позже.":batchNotice);
                return;
            }
            for(String u:pendingUrls){
                JSONObject record=new JSONObject();record.put("url",u);record.put("title",pendingTitles.containsKey(u)?pendingTitles.get(u):u);
                record.put("date",System.currentTimeMillis());record.put("domain",batchOrigin);library.put(record);
            }
            saveLibrary();
            int mode=prefs.getInt("openMode",0);openBatch(new ArrayList<>(pendingUrls),mode);
            String message="Выбрано "+pendingUrls.size()+" карточек с разных страниц и сохранено в базе. Всего записей: "+library.length();
            if(pendingUrls.size()<requested)message+=" Проверено не более "+maxPageChecks+" страниц за один запуск.";
            if(!batchNotice.isEmpty())message+=" "+batchNotice;
            setStatus(message);
            String ghToken=prefs.getString("ghToken","");if(!ghToken.isEmpty())syncGithub(ghToken,prefs.getString("ghGist",""));
        }catch(Exception e){setStatus("Ошибка сохранения выбранных карточек: "+e.getMessage());}
        finally{
            randomInProgress=false;batchToken++;batchNotice="";pendingPage=-1;pendingTotal=1;pendingChosen=0;
            pendingPages.clear();pendingBatchUrls.clear();pendingUrls.clear();attemptedPages.clear();pendingTitles.clear();
        }
    }
    void pickFrom(JSONArray cards){
        try{
            if(cards==null||cards.length()==0){setStatus("На странице не найдены карточки. Если сайт показывает проверку, пройди её в браузере и попробуй снова.");return;}
            HashSet<String> used=usedUrls(); ArrayList<JSONObject> candidates=new ArrayList<>();
            for(int i=0;i<cards.length();i++){JSONObject x=cards.getJSONObject(i);if(!used.contains(x.getString("url")))candidates.add(x);}
            if(candidates.isEmpty()){setStatus("На этой странице все фильмы уже выбраны. Попробуй ещё раз.");return;}
            Collections.shuffle(candidates);
            int wanted=1;
            try { wanted=Math.max(1,Math.min(30,Integer.parseInt(count.getText().toString().trim()))); } catch(Exception ignored) {}
            int n=Math.min(wanted,candidates.size());
            ArrayList<String> urls=new ArrayList<>();
            for(int i=0;i<n;i++){
                JSONObject pick=candidates.get(i); String u=pick.getString("url");
                JSONObject record=new JSONObject();record.put("url",u);record.put("title",pick.optString("title","Без названия"));
                record.put("date",System.currentTimeMillis());record.put("domain",origin());
                library.put(record);urls.add(u);
            }
            saveLibrary();
            int mode=prefs.getInt("openMode",0);
            openBatch(urls,mode);
            setStatus("Выбрано и сохранено карточек: "+n+". Всего записей: "+library.length());
            String ghToken=prefs.getString("ghToken","");
            if(!ghToken.isEmpty()) syncGithub(ghToken,prefs.getString("ghGist",""));
        }catch(Exception e){setStatus("Ошибка: "+e.getMessage());}
    }

    void switchMode(boolean simple){
        if(randomInProgress){setStatus("Сначала дождись завершения текущего подбора, затем переключи режим.");return;}
        if(simpleMode==simple)return;
        simpleMode=simple;prefs.edit().putBoolean("simpleMode",simple).apply();applyModeVisibility();
    }
    void applyModeVisibility(){
        simpleModeButton.setVisibility(simpleMode?View.GONE:View.VISIBLE);
        advancedModeButton.setVisibility(simpleMode?View.VISIBLE:View.GONE);
        advancedPanel.setVisibility(simpleMode?View.GONE:View.VISIBLE);
        random.setVisibility(View.VISIBLE);
        random.setText(simpleMode?"🎲 ВЫБРАТЬ СЛУЧАЙНУЮ КАРТОЧКУ":"🎲 ВЫБРАТЬ СЛУЧАЙНЫЕ КАРТОЧКИ");
        if(!simpleMode){
            year.setText(prefs.getString("yearAdvanced",""));
            count.setText(prefs.getString("countAdvanced","1"));
            type.setSelection(Math.max(0,Math.min(prefs.getInt("categoryAdvanced",0),types.length-1)));
        }
    }
    void setupTimeoutControls(){
        styleChoiceSpinner(requestInterval,intervalOptions,indexOf(intervalSeconds,prefs.getInt("requestIntervalSeconds",2)),Color.BLACK,true);
        styleChoiceSpinner(protectionCooldown,cooldownOptions,indexOf(cooldownMinutes,prefs.getInt("protectionCooldownMinutes",15)),Color.BLACK,true);
        requestInterval.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int pos,long id){prefs.edit().putInt("requestIntervalSeconds",intervalSeconds[Math.max(0,Math.min(pos,intervalSeconds.length-1))]).apply();}
            public void onNothingSelected(android.widget.AdapterView<?> p){}
        });
        protectionCooldown.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int pos,long id){prefs.edit().putInt("protectionCooldownMinutes",cooldownMinutes[Math.max(0,Math.min(pos,cooldownMinutes.length-1))]).apply();}
            public void onNothingSelected(android.widget.AdapterView<?> p){}
        });
    }
    int indexOf(int[] choices,int value){for(int i=0;i<choices.length;i++)if(choices[i]==value)return i;return 0;}
    void styleChoiceSpinner(Spinner spinner,String[] values,int selected,int foreground,boolean light){
        spinner.setPopupBackgroundDrawable(new android.graphics.drawable.ColorDrawable(light?Color.WHITE:Color.rgb(38,42,50)));
        spinner.setBackgroundTintList(android.content.res.ColorStateList.valueOf(light?Color.rgb(70,80,96):Color.rgb(190,198,210)));
        spinner.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,values){
            {setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);}
            @Override public android.view.View getView(int position,android.view.View convert,android.view.ViewGroup parent){
                TextView tv=(TextView)super.getView(position,convert,parent);tv.setTextColor(foreground);tv.setPadding(12,8,12,8);return tv;
            }
            @Override public android.view.View getDropDownView(int position,android.view.View convert,android.view.ViewGroup parent){
                TextView tv=(TextView)super.getDropDownView(position,convert,parent);tv.setTextColor(foreground);tv.setBackgroundColor(light?Color.WHITE:Color.rgb(38,42,50));tv.setPadding(18,18,18,18);return tv;
            }
        });
        spinner.setSelection(Math.max(0,Math.min(selected,values.length-1)));
    }
    void openSettingsWindow(){
        LinearLayout root=findViewById(R.id.root);
        if(settingsPanel.getParent()!=root)return;
        android.view.ViewGroup parent=(android.view.ViewGroup)settingsPanel.getParent();
        int childIndex=parent.indexOfChild(settingsPanel);
        android.view.ViewGroup.LayoutParams layoutParams=settingsPanel.getLayoutParams();
        parent.removeView(settingsPanel);settingsPanel.setVisibility(View.VISIBLE);
        ScrollView content=new ScrollView(this);content.setFillViewport(false);
        int pad=(int)(20*getResources().getDisplayMetrics().density);content.setPadding(pad,0,pad,0);
        content.addView(settingsPanel,new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT,ScrollView.LayoutParams.WRAP_CONTENT));
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Настройки").setView(content).setPositiveButton("Готово",null).create();
        dialog.setOnDismissListener(d->{
            if(settingsPanel.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)settingsPanel.getParent()).removeView(settingsPanel);
            settingsPanel.setVisibility(View.GONE);
            root.addView(settingsPanel,Math.min(childIndex,root.getChildCount()),layoutParams);
        });
        dialog.show();dialog.getWindow().setLayout((int)(getResources().getDisplayMetrics().widthPixels*0.94),Math.max(500,getResources().getDisplayMetrics().heightPixels*3/4));
    }

    String hdrezkaUrl(String original){
        try{
            Uri u=Uri.parse(original);
            if(u.getHost()==null)return original;
            return u.buildUpon().authority("hdrzk.org").build().toString();
        }catch(Exception e){return original;}
    }
    void openFilm(String original){
        int mode=prefs.getInt("openMode",0);
        if(mode==2){
            new AlertDialog.Builder(this).setTitle("Где открыть фильм?")
                .setItems(new String[]{"HDRezka App","Браузер"},(d,which)->openFilmWithMode(original,which==0?1:0)).show();
        }else openFilmWithMode(original,mode);
    }
    void openFilmWithMode(String original,int mode){
        String target=mode==1?hdrezkaUrl(original):original;
        Intent view=new Intent(Intent.ACTION_VIEW,Uri.parse(target)); view.addCategory(Intent.CATEGORY_BROWSABLE);
        try{
            startActivity(view);
        }catch(Exception e){
            try{Intent fallback=new Intent(Intent.ACTION_VIEW,Uri.parse(original));fallback.addCategory(Intent.CATEGORY_BROWSABLE);startActivity(fallback);
                if(mode==1)setStatus("HDRezka App не найдена; ссылка открыта в браузере.");
            }catch(Exception ex){setStatus("Не удалось открыть ссылку: "+ex.getMessage());}
        }
    }
    void openBatch(ArrayList<String> urls,int mode){
        if(urls.isEmpty())return;
        if(mode==2){
            new AlertDialog.Builder(this).setTitle("Где открыть карточки?")
                .setItems(new String[]{"HDRezka App","Браузер"},(d,which)->openBatchSelected(urls,which==0?1:0)).show();
        }else openBatchSelected(urls,mode);
    }
    void openBatchSelected(ArrayList<String> urls,int mode){
        if(mode==1){openFilmWithMode(urls.get(0),1);return;}
        for(int i=0;i<urls.size();i++){final String u=urls.get(i);new android.os.Handler(getMainLooper()).postDelayed(()->openFilmWithMode(u,0),i*650L);}
    }
    int maximumSelectableYear(){return Math.max(2027,java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)+20);}
    void adjustYear(int delta){
        String raw=year.getText().toString().trim();int current;
        try{current=Integer.parseInt(raw);}catch(Exception e){current=java.util.Calendar.getInstance().get(java.util.Calendar.YEAR);}
        int next=Math.max(1900,Math.min(maximumSelectableYear(),current+delta));
        year.setText(String.valueOf(next));year.setSelection(year.length());
    }
    android.text.TextWatcher simpleWatcher(String key){
        return new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            public void onTextChanged(CharSequence s,int start,int before,int count){if(prefs!=null)prefs.edit().putString(key,s.toString()).apply();}
            public void afterTextChanged(android.text.Editable e){}};
    }

    HashSet<String> usedUrls(){
        HashSet<String> out=new HashSet<>();
        try{for(int i=0;i<library.length();i++)out.add(library.getJSONObject(i).optString("url",""));}catch(Exception ignored){}
        String saved=prefs.getString("used","");
        try{JSONArray old=new JSONArray(saved);for(int i=0;i<old.length();i++)out.add(old.getString(i));}catch(Exception ignored){}
        return out;
    }
    void loadLibrary(){try{library=new JSONArray(prefs.getString("library","[]"));}catch(Exception e){library=new JSONArray();}}
    void saveLibrary(){prefs.edit().putString("library",library.toString()).putString("used",new JSONArray(usedUrls()).toString()).apply();}
    void setStatus(String s){status.setText(s);}
    void showDatabase(){
        StringBuilder text=new StringBuilder("В базе: ").append(library.length()).append(" записей\n\n");
        for(int i=library.length()-1;i>=0;i--){JSONObject x=library.optJSONObject(i);if(x!=null)text.append(x.optString("title","Без названия")).append("\n").append(x.optString("url","")).append("\n\n");}
        new AlertDialog.Builder(this).setTitle("Моя база").setMessage(text.toString())
            .setPositiveButton("Случайный из базы",(d,w)->openRandomSaved())
            .setNeutralButton("Очистить базу",(d,w)->new AlertDialog.Builder(this).setMessage("Удалить всю базу и историю без повторов?")
                .setNegativeButton("Отмена",null).setPositiveButton("Удалить",(a,b)->{library=new JSONArray();prefs.edit().putString("used","[]").apply();saveLibrary();setStatus("База и история очищены.");}).show())
            .setNegativeButton("Закрыть",null).show();
    }
    void openRandomSaved(){
        if(library.length()==0){setStatus("База пуста.");return;}
        JSONObject x=library.optJSONObject(new Random().nextInt(library.length()));
        if(x!=null){String u=x.optString("url","");if(!u.isEmpty())openFilm(u);}
    }
    JSONObject exportObject(){JSONObject o=new JSONObject();try{o.put("format","rezkery-randomizer-db");o.put("version",1);o.put("items",library);o.put("used",new JSONArray(usedUrls()));}catch(Exception ignored){}return o;}
    String htmlExport(){
        StringBuilder h=new StringBuilder("<!doctype html><html lang='ru'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Rezkery Randomizer — база</title><style>body{font:16px sans-serif;max-width:900px;margin:2em auto;padding:0 1em;background:#111317;color:#eee}a{color:#83baff}li{margin:1em 0}</style><h1>Rezkery Randomizer — база</h1><p>Экспортировано записей: ").append(library.length()).append("</p><ol>");
        for(int i=0;i<library.length();i++){JSONObject x=library.optJSONObject(i);if(x!=null)h.append("<li><a href='").append(escapeHtml(x.optString("url",""))).append("'>").append(escapeHtml(x.optString("title","Без названия"))).append("</a></li>");}
        return h.append("</ol><script type='application/json' id='rezkery-db'>").append(exportObject().toString().replace("<","\\u003c")).append("</script></html>").toString();
    }
    String escapeHtml(String s){return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;");}
    void chooseExport(int code,String name,String mime){Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(mime);i.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(i,code);}
    void chooseImport(String mime){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(mime);startActivityForResult(i,PICK_IMPORT);}
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);if(resultCode!=RESULT_OK||data==null||data.getData()==null)return;
        Uri uri=data.getData();
        try{
            if(requestCode==PICK_EXPORT_JSON||requestCode==PICK_EXPORT_HTML){
                String content=requestCode==PICK_EXPORT_HTML?htmlExport():exportObject().toString(2);
                try(OutputStream out=getContentResolver().openOutputStream(uri)){out.write(content.getBytes(StandardCharsets.UTF_8));}
                setStatus("Экспорт завершён: "+uri.getLastPathSegment());
            }else if(requestCode==PICK_IMPORT){
                String content=readUri(uri);String trimmed=content.trim();JSONArray incoming;JSONArray importedUsed=null;
                if(trimmed.toLowerCase(Locale.ROOT).contains("<html")){
                    String embedded=extractEmbeddedJson(content);
                    if(embedded==null)throw new Exception("В HTML не найдена встроенная база Rezkery Randomizer.");
                    Object parsed=new JSONTokener(embedded).nextValue();
                    if(parsed instanceof JSONArray)incoming=(JSONArray)parsed;
                    else if(parsed instanceof JSONObject){JSONObject o=(JSONObject)parsed;incoming=firstArray(o,"items","movies","data");importedUsed=o.optJSONArray("used");}
                    else throw new Exception("В HTML найдены данные неизвестного формата.");
                }else{
                    Object parsed=new JSONTokener(trimmed).nextValue();
                    if(parsed instanceof JSONArray)incoming=(JSONArray)parsed;
                    else if(parsed instanceof JSONObject){JSONObject o=(JSONObject)parsed;incoming=firstArray(o,"items","movies","data");importedUsed=o.optJSONArray("used");}
                    else throw new Exception("Файл должен содержать JSON-массив карточек.");
                }
                if(incoming==null)throw new Exception("Файл не содержит списка items или movies.");
                mergeLibrary(incoming);
                if(importedUsed!=null){HashSet<String> used=usedUrls();for(int i=0;i<importedUsed.length();i++){String u=importedUsed.optString(i,"");if(!u.isEmpty())used.add(u);}prefs.edit().putString("used",new JSONArray(used).toString()).apply();}
                setStatus("Импорт завершён. Всего записей: "+library.length());
            }
        }catch(Exception e){setStatus("Не удалось обработать файл: "+e.getMessage());}
    }
    JSONArray firstArray(JSONObject object,String... keys){
        for(String key:keys){JSONArray value=object.optJSONArray(key);if(value!=null)return value;}return null;
    }
    String extractEmbeddedJson(String html){
        String[] ids={"rezkery-db","rezkery-data"};
        for(String id:ids){
            java.util.regex.Matcher m=java.util.regex.Pattern.compile("<script[^>]*id=[\\\"']"+id+"[\\\"'][^>]*>([\\s\\S]*?)</script>",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(html);
            if(m.find())return m.group(1).trim();
        }
        return null;
    }
    String readUri(Uri uri)throws Exception{StringBuilder b=new StringBuilder();try(InputStream in=getContentResolver().openInputStream(uri);BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){String line;while((line=r.readLine())!=null)b.append(line).append('\n');}return b.toString();}
    void mergeLibrary(JSONArray incoming)throws Exception{
        LinkedHashMap<String,JSONObject> map=new LinkedHashMap<>();
        for(int i=0;i<library.length();i++){JSONObject x=library.optJSONObject(i);if(x!=null)map.put(x.optString("url",""),x);}
        for(int i=0;i<incoming.length();i++){JSONObject x=incoming.optJSONObject(i);if(x!=null&&!x.optString("url","").isEmpty())map.put(x.optString("url"),x);}
        library=new JSONArray();for(JSONObject x:map.values())library.put(x);saveLibrary();
    }
    void githubDialog(){
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(28,12,28,0);
        EditText token=new EditText(this);token.setHint("GitHub token с правом gist");token.setInputType(129);token.setText(prefs.getString("ghToken",""));box.addView(token);
        EditText gist=new EditText(this);gist.setHint("ID Gist (оставь пустым для создания)");gist.setText(prefs.getString("ghGist",""));box.addView(gist);
        new AlertDialog.Builder(this).setTitle("Синхронизация GitHub Gist").setMessage("Создаст или обновит приватный Gist с JSON-базой. Токен хранится локально на устройстве. Создай fine-grained/classic token с доступом gist.")
            .setView(box).setNegativeButton("Отмена",null).setPositiveButton("Синхронизировать",(d,w)->{
                String t=token.getText().toString().trim(),g=gist.getText().toString().trim();
                if(t.isEmpty()){setStatus("Нужен GitHub token с разрешением gist.");return;}
                prefs.edit().putString("ghToken",t).putString("ghGist",g).apply();syncGithub(t,g);
            }).show();
    }
    String configuredMirrorOrigin(){
        String configured=domain.getText().toString().trim();
        if(configured.isEmpty())configured=prefs.getString("domainAdvanced","https://rezkery.com");
        if(!configured.matches("(?i)^https?://.*"))configured="https://"+configured;
        return configured.replaceAll("/+$","");
    }
    String openLoginFormScript(){
        return "(function(){"+
            "const visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');"+
            "const forms=[...document.querySelectorAll('input[type=password]')];if(forms.some(visible))return 'form';"+
            "const els=[...document.querySelectorAll('a,button,[role=button],[onclick]')].filter(visible);"+
            "const re=/(войти|вход|авторизац|sign.?in|log.?in)/i;"+
            "let e=els.find(x=>re.test((x.innerText||'')+' '+(x.getAttribute('aria-label')||'')+' '+(x.getAttribute('title')||'')));"+
            "if(!e)e=els.find(x=>/login|auth|account/i.test((x.getAttribute('href')||'')+' '+x.className));"+
            "if(e){const href=e.getAttribute('href');if(href&&!href.startsWith('#')&&!/^javascript:/i.test(href)&&!(/login|auth/i.test(location.href)))location.href=e.href;else e.click();return 'opened';}"+
            "return 'missing';})()";
    }
    void hdrezkaSyncDialog(){
        if(library.length()==0){setStatus("Локальная база пуста — сначала выбери карточки.");return;}
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);
        TextView hint=new TextView(this);hint.setText("Вход откроется на выбранном в настройках зеркале. Если сайт запросит проверку, пройди её вручную.");hint.setPadding(28,16,28,12);box.addView(hint);
        TextView pageStatus=new TextView(this);pageStatus.setText("Открываю форму входа…");pageStatus.setPadding(28,4,28,8);box.addView(pageStatus);
        WebView loginWeb=new WebView(this);
        loginWeb.setFocusable(true);loginWeb.setFocusableInTouchMode(true);
        loginWeb.getSettings().setJavaScriptEnabled(true);loginWeb.getSettings().setDomStorageEnabled(true);
        loginWeb.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);loginWeb.getSettings().setSupportMultipleWindows(false);
        loginWeb.getSettings().setUseWideViewPort(true);loginWeb.getSettings().setLoadWithOverviewMode(true);
        loginWeb.getSettings().setBuiltInZoomControls(true);loginWeb.getSettings().setDisplayZoomControls(false);loginWeb.getSettings().setTextZoom(100);
        String browserAgent=loginWeb.getSettings().getUserAgentString();loginWeb.getSettings().setUserAgentString(browserAgent.replace("; wv",""));
        CookieManager cookieManager=CookieManager.getInstance();cookieManager.setAcceptCookie(true);
        if(android.os.Build.VERSION.SDK_INT>=21)cookieManager.setAcceptThirdPartyCookies(loginWeb,true);
        loginWeb.setWebChromeClient(new WebChromeClient());
        loginWeb.setWebViewClient(new WebViewClient(){
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){pageStatus.setText("Загрузка формы входа…");}
            @Override public void onPageFinished(WebView view,String url){
                cookieManager.flush();
                view.evaluateJavascript("(document.title+' '+(document.body?document.body.innerText:'' )).slice(0,2500)",value->{
                    String pageText="";
                    try{Object decoded=new JSONTokener(value==null?"":value).nextValue();pageText=String.valueOf(decoded).toLowerCase(Locale.ROOT);}catch(Exception ignored){}
                    if(pageText.matches("(?s).*(anubis|cloudflare|captcha|провер(ка|ьте).*человек|подтвердите.*человек).*")){
                        pageStatus.setText("Сайт запросил проверку на бота. Пройди её в окне и дождись загрузки страницы.");
                        return;
                    }
                    view.evaluateJavascript(openLoginFormScript(),result->{
                        String outcome="";
                        try{Object decoded=new JSONTokener(result==null?"":result).nextValue();outcome=String.valueOf(decoded);}catch(Exception ignored){}
                        if("opened".equals(outcome)||"form".equals(outcome))pageStatus.setText("Форма авторизации открыта. Нажми поля логина или пароля, чтобы вызвать клавиатуру.");
                        else pageStatus.setText("На этой странице не найдена кнопка входа. Проверь адрес зеркала в настройках или открой меню аккаунта.");
                    });
                });
            }
        });
        int webHeight=(int)(520*getResources().getDisplayMetrics().density);
        box.addView(loginWeb,new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,webHeight));
        boolean[] webDestroyed={false};
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Закладки HDRezka").setView(box)
            .setNegativeButton("Закрыть",(d,w)->{webDestroyed[0]=true;loginWeb.stopLoading();loginWeb.destroy();})
            .setNeutralButton("Синхронизировать",null).create();
        dialog.setOnShowListener(d->{
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->syncHdrezkaBookmarks(loginWeb,dialog));
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
            loginWeb.requestFocus(View.FOCUS_DOWN);
        });
        dialog.setOnDismissListener(d->{if(!webDestroyed[0]){webDestroyed[0]=true;loginWeb.stopLoading();loginWeb.destroy();}});
        dialog.show();
        int dialogHeight=Math.min((int)(getResources().getDisplayMetrics().heightPixels*0.9),webHeight+(int)(180*getResources().getDisplayMetrics().density));
        dialog.getWindow().setLayout(LinearLayout.LayoutParams.MATCH_PARENT,dialogHeight);
        loginWeb.loadUrl(configuredMirrorOrigin()+"/");
    }
    void syncHdrezkaBookmarks(WebView target,AlertDialog dialog){
        JSONArray movies=new JSONArray();
        for(int i=0;i<library.length();i++){JSONObject item=library.optJSONObject(i);if(item!=null){JSONObject movie=new JSONObject();try{movie.put("url",item.optString("url",""));movie.put("title",item.optString("title",""));movies.put(movie);}catch(Exception ignored){}}}
        if(movies.length()==0){setStatus("В базе нет карточек для синхронизации.");return;}
        String script="(async function(){try{const movies="+movies.toString()+";"+
            "const get=async u=>{const r=await fetch(u,{credentials:'include',redirect:'follow'});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()};"+
            "const api=async data=>{const r=await fetch(new URL('/ajax/favorites/',location.origin),{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams(data).toString()});const t=await r.text();let j;try{j=JSON.parse(t)}catch(e){throw new Error('Ответ HDRezka не JSON: войди в аккаунт и повтори попытку')}if(!r.ok||j.success===false)throw new Error(j.message||('Ошибка закладок HTTP '+r.status));return j};"+
            "const catsFrom=html=>{const d=new DOMParser().parseFromString(html,'text/html');let id='';d.querySelectorAll('a.b-favorites_content__cats_list_link').forEach(a=>{const n=(a.querySelector('.name')||a).textContent.trim();const m=(a.getAttribute('href')||'').match(/\\/favorites\\/(\\d+)/);if(n.toLocaleUpperCase()==='RANDOM'&&m)id=m[1]});return id};"+
            "let html=await get(new URL('/favorites/',location.origin));if(!/b-favorites_content__cats_list_link/.test(html)&&/name=['\\\"](?:login|email)|Войти в аккаунт|Вход в аккаунт/i.test(html))throw new Error('Войди в аккаунт HDRezka в этом окне.');"+
            "let cat=catsFrom(html);if(!cat){const c=await api({action:'add_cat',name:'RANDOM'});cat=String(c.id||(c.data&&c.data.id)||'');if(!cat)cat=catsFrom(await get(new URL('/favorites/',location.origin)));if(!cat)throw new Error('Не удалось создать или найти папку RANDOM.')}"+
            "const page=await get(new URL('/favorites/'+cat+'/',location.origin));const doc=new DOMParser().parseFromString(page,'text/html'),existing=Object.create(null);const postId=u=>{try{const p=new URL(u).pathname,m=p.match(/(?:^|\\/)(\\d+)-[^/]+\\.html?$/i)||p.match(/(?:^|\\/)(\\d+)(?:\\/|$)/);return m?m[1]:''}catch(e){return''}};doc.querySelectorAll('a[href]').forEach(a=>{const id=postId(a.href);if(id)existing[id]=1});"+
            "let added=0,skipped=0,failed=[];for(const m of movies){const id=postId(m.url);if(!id){failed.push((m.title||m.url)+': не удалось извлечь ID');continue}if(existing[id]){skipped++;continue}try{await api({action:'add_post',post_id:id,cat_id:cat});existing[id]=1;added++}catch(e){failed.push((m.title||id)+': '+e.message)}await new Promise(resolve=>setTimeout(resolve,1100))}"+
            "return JSON.stringify({ok:true,added:added,skipped:skipped,failed:failed})}catch(e){return JSON.stringify({ok:false,error:String(e.message||e)})}})()";
        setStatus("Синхронизирую закладки HDRezka…");
        target.evaluateJavascript(script,value->{try{
            Object decoded=new JSONTokener(value==null?"":value).nextValue();
            JSONObject result=new JSONObject(String.valueOf(decoded));
            if(!result.optBoolean("ok")){setStatus("HDRezka: "+result.optString("error","не удалось выполнить синхронизацию."));return;}
            String msg="Папка RANDOM: добавлено "+result.optInt("added")+", уже было "+result.optInt("skipped")+".";
            JSONArray failed=result.optJSONArray("failed");if(failed!=null&&failed.length()>0)msg+=" Ошибки: "+failed.optString(0);
            setStatus(msg);dialog.dismiss();target.destroy();
        }catch(Exception e){setStatus("Не удалось прочитать ответ HDRezka: "+e.getMessage());}});
    }

    void syncGithub(String token,String gistId){
        setStatus("Синхронизация с GitHub…");
        new Thread(()->{HttpURLConnection c=null;try{
            boolean update=!gistId.isEmpty();URL url=new URL(update?"https://api.github.com/gists/"+gistId:"https://api.github.com/gists");
            c=(HttpURLConnection)url.openConnection();c.setRequestMethod(update?"PATCH":"POST");c.setConnectTimeout(15000);c.setReadTimeout(15000);
            c.setRequestProperty("Authorization","Bearer "+token);c.setRequestProperty("Accept","application/vnd.github+json");c.setRequestProperty("X-GitHub-Api-Version","2022-11-28");c.setRequestProperty("Content-Type","application/json");c.setDoOutput(true);
            JSONObject files=new JSONObject();JSONObject file=new JSONObject();file.put("content",exportObject().toString(2));files.put("rezkery-database.json",file);
            JSONObject payload=new JSONObject();payload.put("description","Rezkery Randomizer database");payload.put("public",false);payload.put("files",files);
            try(OutputStream out=c.getOutputStream()){out.write(payload.toString().getBytes(StandardCharsets.UTF_8));}
            int code=c.getResponseCode();InputStream stream=code>=200&&code<300?c.getInputStream():c.getErrorStream();StringBuilder body=new StringBuilder();try(BufferedReader r=new BufferedReader(new InputStreamReader(stream,StandardCharsets.UTF_8))){String line;while((line=r.readLine())!=null)body.append(line);}
            if(code<200||code>=300)throw new Exception("GitHub API HTTP "+code+": "+body);
            JSONObject response=new JSONObject(body.toString());String id=response.optString("id",gistId);
            prefs.edit().putString("ghGist",id).apply();runOnUiThread(()->setStatus("GitHub-синхронизация успешна. Gist ID: "+id));
        }catch(Exception e){String msg=e.getMessage();runOnUiThread(()->setStatus("Ошибка GitHub-синхронизации: "+msg));}finally{if(c!=null)c.disconnect();}}).start();
    }
}
