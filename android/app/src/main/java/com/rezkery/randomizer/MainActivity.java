package com.rezkery.randomizer;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.*;
import android.view.View;
import org.json.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class MainActivity extends Activity {
    EditText domain, year, count;
    AutoCompleteTextView yearDropdown;
    Button yearMinus, yearPlus, hdrezkaSyncButton;
    TextView title;
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
        domain=findViewById(R.id.domain); year=findViewById(R.id.year); count=findViewById(R.id.count); type=findViewById(R.id.type);
        status=findViewById(R.id.status); subtitle=findViewById(R.id.subtitle); title=findViewById(R.id.title); web=findViewById(R.id.web);
        yearDropdown=findViewById(R.id.year); yearMinus=findViewById(R.id.yearMinus); yearPlus=findViewById(R.id.yearPlus);
        hdrezkaSyncButton=findViewById(R.id.hdrezkaSync);
        openMode=findViewById(R.id.openMode);
        simpleModeButton=findViewById(R.id.simpleMode); advancedModeButton=findViewById(R.id.advancedMode);
        simpleMode=prefs.getBoolean("simpleMode",true);
        random=findViewById(R.id.random); themeButton=findViewById(R.id.theme);
        databaseButton=findViewById(R.id.database); exportJsonButton=findViewById(R.id.exportJson);
        importJsonButton=findViewById(R.id.importJson); exportHtmlButton=findViewById(R.id.exportHtml);
        importHtmlButton=findViewById(R.id.importHtml); driveExportButton=findViewById(R.id.driveExport);
        driveImportButton=findViewById(R.id.driveImport); githubButton=findViewById(R.id.githubSync);
        domain.setText(prefs.getString("domainAdvanced",prefs.getString("domain","https://rezkery.com")));
        year.setText(prefs.getString("yearAdvanced","")); count.setText(prefs.getString("countAdvanced",prefs.getString("pickCount","1")));
        lightTheme=prefs.getBoolean("lightTheme",false);
        type.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,types) {{
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        }});
        openMode.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,openModes) {{ setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); }});
        openMode.setSelection(Math.max(0,Math.min(prefs.getInt("openMode",0),openModes.length-1)));
        type.setSelection(Math.max(0,Math.min(prefs.getInt("categoryAdvanced",0),types.length-1)));
        ArrayList<String> yearOptions=new ArrayList<>(); for(int y=java.util.Calendar.getInstance().get(java.util.Calendar.YEAR);y>=1900;y--)yearOptions.add(String.valueOf(y));
        ArrayAdapter<String> yearAdapter=new ArrayAdapter<String>(this,android.R.layout.simple_dropdown_item_1line,yearOptions);
        yearDropdown.setAdapter(yearAdapter); yearDropdown.setThreshold(0);
        yearDropdown.setOnFocusChangeListener((v,hasFocus)->{if(hasFocus)yearDropdown.showDropDown();});
        yearMinus.setOnClickListener(v->adjustYear(-1)); yearPlus.setOnClickListener(v->adjustYear(1));
        domain.addTextChangedListener(simpleWatcher("domainAdvanced")); year.addTextChangedListener(simpleWatcher("yearAdvanced")); count.addTextChangedListener(simpleWatcher("countAdvanced"));
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
        simpleModeButton.setOnClickListener(v->{simpleMode=true;prefs.edit().putBoolean("simpleMode",true).apply();applyModeVisibility();});
        advancedModeButton.setOnClickListener(v->{simpleMode=false;prefs.edit().putBoolean("simpleMode",false).apply();applyModeVisibility();});
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
        applyModeVisibility();
        setStatus("База сохранена локально. Повторно выбранные фильмы пропускаются.");
    }

    void applyTheme(){
        int selectedType=type.getSelectedItemPosition();
        int selectedOpenMode=openMode.getSelectedItemPosition();
        int bg=lightTheme?Color.rgb(247,249,252):Color.rgb(17,19,23);
        int fg=lightTheme?Color.rgb(24,29,38):Color.WHITE;
        int muted=lightTheme?Color.rgb(76,86,102):Color.rgb(174,181,193);
        LinearLayout root=findViewById(R.id.root);
        root.setBackgroundColor(bg);
        title.setTextColor(fg); subtitle.setTextColor(muted); status.setTextColor(muted);
        domain.setTextColor(fg); year.setTextColor(fg);
        domain.setHintTextColor(muted); year.setHintTextColor(muted);
        int[][] states=new int[][]{new int[]{android.R.attr.state_enabled},new int[]{}};
        int[] colors=new int[]{fg,fg};
        type.setPopupBackgroundDrawable(new android.graphics.drawable.ColorDrawable(lightTheme?Color.WHITE:Color.rgb(38,42,50)));
        openMode.setPopupBackgroundDrawable(new android.graphics.drawable.ColorDrawable(lightTheme?Color.WHITE:Color.rgb(38,42,50)));
        openMode.setBackgroundTintList(android.content.res.ColorStateList.valueOf(lightTheme?Color.rgb(70,80,96):Color.rgb(190,198,210)));
        type.setBackgroundTintList(android.content.res.ColorStateList.valueOf(lightTheme?Color.rgb(70,80,96):Color.rgb(190,198,210)));
        for(Button b:new Button[]{random,themeButton,databaseButton,exportJsonButton,importJsonButton,exportHtmlButton,importHtmlButton,driveExportButton,driveImportButton,githubButton,hdrezkaSyncButton,yearMinus,yearPlus,simpleModeButton,advancedModeButton}){
            b.setTextColor(lightTheme?Color.WHITE:Color.rgb(20,22,26));
            b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(lightTheme?Color.rgb(42,91,170):Color.rgb(224,228,234)));
        }
        themeButton.setText(lightTheme?"☾ Тёмная тема":"☀ Светлая тема");
        getWindow().setStatusBarColor(bg); getWindow().setNavigationBarColor(bg);
        getWindow().getDecorView().setSystemUiVisibility(lightTheme?ViewFlags.LIGHT_STATUS:0);
        // Force readable dropdown text; the adapter is recreated when theme changes.
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
    }
    static class ViewFlags { static final int LIGHT_STATUS=0x00002000; }

    String origin(){
        String d=simpleMode?"https://rezkery.com":domain.getText().toString().trim();
        if(!d.matches("(?i)^https?://.*")) d="https://"+d;
        return d.replaceAll("/+$","");
    }
    String pageUrl(int page){
        int t=simpleMode?0:type.getSelectedItemPosition(); String y=simpleMode?"":year.getText().toString().trim(); String g=genres[t];
        String path;
        if(!y.isEmpty()) path=origin()+"/year/"+y+(page>1?"/page/"+page+"/":"/");
        else path=origin()+(page>1?"/page/"+page+"/":"/");
        return path+(g.isEmpty()?"":"?filter=last&genre="+g);
    }
    void startRandom(){
        String y=simpleMode?"":year.getText().toString().trim();
        if(!y.isEmpty()&&!y.matches("\\d{4}")){setStatus("Укажи год четырьмя цифрами, например 1998.");return;}
        if(!simpleMode)prefs.edit().putString("domainAdvanced",origin()).putString("yearAdvanced",y).putString("countAdvanced",count.getText().toString().trim()).putInt("categoryAdvanced",type.getSelectedItemPosition()).apply();
        try { pendingTotal=simpleMode?1:Math.max(1,Math.min(30,Integer.parseInt(count.getText().toString().trim()))); } catch(Exception e){pendingTotal=1;}
        pendingChosen=0; pendingUrls.clear(); pendingBatchUrls.clear(); pendingPages.clear(); attemptedPages.clear(); pendingTitles.clear(); pendingPage=-1;
        setStatus("Определяю страницы каталога…"); web.loadUrl(pageUrl(1));
    }
    String parserScript(){
        return "(function(){var cards=[],seen={};var ns=document.querySelectorAll('.b-content__inline_item');"+
        "for(var i=0;i<ns.length;i++){var n=ns[i],a=n.querySelector('a[href]');if(!a)continue;var u=a.href;if(seen[u])continue;seen[u]=1;var l=n.querySelector('.b-content__inline_item-link');cards.push({url:u,title:(l?l.innerText:a.innerText||'Без названия').trim()});}"+
        "var max=1,as=document.querySelectorAll('a[href]');for(var j=0;j<as.length;j++){var h=as[j].href,m=h.match(/\\/page\\/(\\d+)\\/?(?:\\?.*)?$/);if(m)max=Math.max(max,parseInt(m[1],10)||1);}return JSON.stringify({cards:cards,max:max});})()";
    }
    void handleParsed(String value){
        try{
            String raw=value;
            if(raw.startsWith("\"") && raw.endsWith("\"")) raw=(String)new JSONTokener(raw).nextValue();
            JSONObject r=new JSONObject(raw); int max=Math.max(1,r.optInt("max",1)); JSONArray cards=r.optJSONArray("cards");
            if(pendingPage==-1 && pendingChosen==0 && pendingUrls.isEmpty()){
                // Trust pagination actually found in the loaded page. A fabricated
                // fallback (thousands of pages) can trap the app in an endless scan
                // when the mirror changes its pagination markup or shows a challenge.
                pendingMax=Math.max(1,Math.min(max,10000));
                int wanted=Math.min(pendingTotal,pendingMax);
                ArrayList<Integer> all=new ArrayList<>(); for(int p=1;p<=pendingMax;p++)all.add(p);
                Collections.shuffle(all);
                for(int i=0;i<wanted;i++)pendingPages.add(all.get(i));
                loadNextBatchPage(); return;
            }
            processBatchPage(cards);
        }catch(Exception e){setStatus("Ошибка чтения страницы: "+e.getMessage());}
    }
    void loadNextBatchPage(){
        if(pendingPages.isEmpty() || pendingChosen>=pendingTotal){finishBatch();return;}
        pendingPage=pendingPages.remove(0); attemptedPages.add(pendingPage);
        setStatus("Выбираю карточку "+(pendingChosen+1)+" из "+pendingTotal+" — страница "+pendingPage+"…");
        web.loadUrl(pageUrl(pendingPage));
    }
    void processBatchPage(JSONArray cards) throws Exception {
        HashSet<String> used=usedUrls(); used.addAll(pendingBatchUrls);
        ArrayList<JSONObject> candidates=new ArrayList<>();
        if(cards!=null) for(int i=0;i<cards.length();i++){
            JSONObject x=cards.getJSONObject(i); String u=x.optString("url","");
            if(!u.isEmpty()&&!used.contains(u)) candidates.add(x);
        }
        if(!candidates.isEmpty()){
            JSONObject pick=candidates.get(new Random().nextInt(candidates.size()));
            String u=pick.getString("url"); pendingBatchUrls.add(u); pendingUrls.add(u);
            pendingTitles.put(u,pick.optString("title",u)); pendingChosen++;
        }
        if(pendingChosen<pendingTotal && pendingPages.isEmpty()){
            ArrayList<Integer> extra=new ArrayList<>();
            for(int p=1;p<=pendingMax;p++)if(!attemptedPages.contains(p))extra.add(p);
            Collections.shuffle(extra);
            for(int p:extra){pendingPages.add(p);if(pendingPages.size()>=pendingTotal-pendingChosen)break;}
        }
        if(!pendingPages.isEmpty() && pendingChosen<pendingTotal){loadNextBatchPage();return;}
        finishBatch();
    }
    void finishBatch(){
        try{
            if(pendingUrls.isEmpty()){setStatus("Не удалось найти новые карточки на разных страницах. Попробуй снова.");return;}
            for(String u:pendingUrls){
                JSONObject record=new JSONObject();record.put("url",u);record.put("title",pendingTitles.containsKey(u)?pendingTitles.get(u):u);
                record.put("date",System.currentTimeMillis());record.put("domain",origin());library.put(record);
            }
            saveLibrary();
            int mode=prefs.getInt("openMode",0);
            openBatch(new ArrayList<>(pendingUrls),mode);
            setStatus("Выбрано "+pendingUrls.size()+" карточек с разных страниц и сохранено в базе. Всего записей: "+library.length());
            String ghToken=prefs.getString("ghToken","");if(!ghToken.isEmpty())syncGithub(ghToken,prefs.getString("ghGist",""));
        }catch(Exception e){setStatus("Ошибка сохранения выбранных карточек: "+e.getMessage());}
        finally{pendingPage=-1;pendingTotal=1;pendingChosen=0;pendingPages.clear();pendingBatchUrls.clear();pendingUrls.clear();attemptedPages.clear();pendingTitles.clear();}
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

    void applyModeVisibility(){
        int advanced=simpleMode?View.GONE:View.VISIBLE;
        int[] ids={R.id.domainLabel,R.id.domain,R.id.categoryLabel,R.id.type,R.id.yearLabel,R.id.year,R.id.yearMinus,R.id.yearPlus,R.id.countLabel,R.id.count,
            R.id.theme,R.id.database,R.id.backupTitle,R.id.exportJson,R.id.importJson,R.id.exportHtml,R.id.importHtml,
            R.id.driveTitle,R.id.driveDescription,R.id.driveExport,R.id.driveImport,R.id.githubTitle,R.id.githubDescription,R.id.githubSync,R.id.hdrezkaSync};
        for(int id:ids){android.view.View v=findViewById(id);if(v!=null)v.setVisibility(advanced);}
        simpleModeButton.setVisibility(simpleMode?View.GONE:View.VISIBLE);
        advancedModeButton.setVisibility(simpleMode?View.VISIBLE:View.GONE);
        random.setText(simpleMode?"🎲 ВЫБРАТЬ СЛУЧАЙНУЮ КАРТОЧКУ":"ОТКРЫТЬ СЛУЧАЙНЫЕ КАРТОЧКИ");
        if(!simpleMode){domain.setText(prefs.getString("domainAdvanced",prefs.getString("domain","https://rezkery.com")));year.setText(prefs.getString("yearAdvanced",""));count.setText(prefs.getString("countAdvanced",prefs.getString("pickCount","1")));type.setSelection(Math.max(0,Math.min(prefs.getInt("categoryAdvanced",0),types.length-1)));}
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
            if(mode==1){view.setPackage("com.hdrezka");}
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
    void adjustYear(int delta){
        String raw=year.getText().toString().trim();int current;
        try{current=Integer.parseInt(raw);}catch(Exception e){current=java.util.Calendar.getInstance().get(java.util.Calendar.YEAR);}
        int next=Math.max(1900,Math.min(java.util.Calendar.getInstance().get(java.util.Calendar.YEAR),current+delta));
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
                String content=readUri(uri);JSONArray incoming;
                if(content.toLowerCase(Locale.ROOT).contains("<html")||content.contains("id='rezkery-db'")||content.contains("id=\"rezkery-db\"")){
                    int a=content.indexOf("id='rezkery-db'");if(a<0)a=content.indexOf("id=\"rezkery-db\"");
                    int gt=content.indexOf('>',a),end=content.indexOf("</script>",gt);
                    if(a<0||gt<0||end<0)throw new Exception("В HTML не найдена встроенная база. Импортируй JSON, созданный приложением.");
                    JSONObject o=new JSONObject(content.substring(gt+1,end));incoming=o.optJSONArray("items");
                }else{JSONObject o=new JSONObject(content);incoming=o.optJSONArray("items");}
                if(incoming==null)throw new Exception("Файл не содержит списка items.");
                mergeLibrary(incoming);setStatus("Импорт завершён. Всего записей: "+library.length());
            }
        }catch(Exception e){setStatus("Не удалось обработать файл: "+e.getMessage());}
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
