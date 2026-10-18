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
import org.json.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class MainActivity extends Activity {
    EditText domain, year;
    Spinner type;
    TextView status, subtitle;
    WebView web;
    Button random, themeButton, databaseButton, exportJsonButton, importJsonButton,
            exportHtmlButton, importHtmlButton, driveExportButton, driveImportButton, githubButton;
    android.content.SharedPreferences prefs;
    String[] types={"Все вместе","Только фильмы","Только сериалы","Только мультфильмы","Только аниме"};
    String[] genres={"","1","2","3","82"};
    int pendingPage=-1;
    static final int PICK_IMPORT=101, PICK_EXPORT_JSON=102, PICK_EXPORT_HTML=103;
    JSONArray library = new JSONArray();
    boolean lightTheme;

    @Override public void onCreate(Bundle b){
        super.onCreate(b); setContentView(R.layout.activity_main);
        prefs=getSharedPreferences("rzk",0);
        domain=findViewById(R.id.domain); year=findViewById(R.id.year); type=findViewById(R.id.type);
        status=findViewById(R.id.status); subtitle=findViewById(R.id.subtitle); web=findViewById(R.id.web);
        random=findViewById(R.id.random); themeButton=findViewById(R.id.theme);
        databaseButton=findViewById(R.id.database); exportJsonButton=findViewById(R.id.exportJson);
        importJsonButton=findViewById(R.id.importJson); exportHtmlButton=findViewById(R.id.exportHtml);
        importHtmlButton=findViewById(R.id.importHtml); driveExportButton=findViewById(R.id.driveExport);
        driveImportButton=findViewById(R.id.driveImport); githubButton=findViewById(R.id.githubSync);
        domain.setText(prefs.getString("domain","https://rezkery.com"));
        lightTheme=prefs.getBoolean("lightTheme",false);
        type.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,types) {{
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        }});
        loadLibrary(); applyTheme();
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String u){ v.evaluateJavascript(parserScript(), value -> handleParsed(value)); }
        });
        random.setOnClickListener(v->startRandom());
        themeButton.setOnClickListener(v->{lightTheme=!lightTheme;prefs.edit().putBoolean("lightTheme",lightTheme).apply();applyTheme();});
        databaseButton.setOnClickListener(v->showDatabase());
        exportJsonButton.setOnClickListener(v->chooseExport(PICK_EXPORT_JSON,"rezkery-database.json","application/json"));
        importJsonButton.setOnClickListener(v->chooseImport("application/json"));
        exportHtmlButton.setOnClickListener(v->chooseExport(PICK_EXPORT_HTML,"rezkery-database.html","text/html"));
        importHtmlButton.setOnClickListener(v->chooseImport("text/*"));
        driveExportButton.setOnClickListener(v->chooseExport(PICK_EXPORT_JSON,"rezkery-drive-backup.json","application/json"));
        driveImportButton.setOnClickListener(v->chooseImport("application/json"));
        githubButton.setOnClickListener(v->githubDialog());
        setStatus("База сохранена локально. Повторно выбранные фильмы пропускаются.");
    }

    void applyTheme(){
        int selectedType=type.getSelectedItemPosition();
        int bg=lightTheme?Color.rgb(247,249,252):Color.rgb(17,19,23);
        int fg=lightTheme?Color.rgb(24,29,38):Color.WHITE;
        int muted=lightTheme?Color.rgb(76,86,102):Color.rgb(174,181,193);
        LinearLayout root=findViewById(R.id.root);
        root.setBackgroundColor(bg);
        subtitle.setTextColor(muted); status.setTextColor(muted);
        domain.setTextColor(fg); year.setTextColor(fg);
        domain.setHintTextColor(muted); year.setHintTextColor(muted);
        int[][] states=new int[][]{new int[]{android.R.attr.state_enabled},new int[]{}};
        int[] colors=new int[]{fg,fg};
        type.setPopupBackgroundDrawable(new android.graphics.drawable.ColorDrawable(lightTheme?Color.WHITE:Color.rgb(38,42,50)));
        type.setBackgroundTintList(android.content.res.ColorStateList.valueOf(lightTheme?Color.rgb(70,80,96):Color.rgb(190,198,210)));
        for(Button b:new Button[]{random,themeButton,databaseButton,exportJsonButton,importJsonButton,exportHtmlButton,importHtmlButton,driveExportButton,driveImportButton,githubButton}){
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
    }
    static class ViewFlags { static final int LIGHT_STATUS=0x00002000; }

    String origin(){
        String d=domain.getText().toString().trim();
        if(!d.matches("(?i)^https?://.*")) d="https://"+d;
        return d.replaceAll("/+$","");
    }
    String pageUrl(int page){
        int t=type.getSelectedItemPosition(); String y=year.getText().toString().trim(); String g=genres[t];
        String path;
        if(!y.isEmpty()) path=origin()+"/year/"+y+(page>1?"/page/"+page+"/":"/");
        else path=origin()+(page>1?"/page/"+page+"/":"/");
        return path+(g.isEmpty()?"":"?filter=last&genre="+g);
    }
    void startRandom(){
        String y=year.getText().toString().trim();
        if(!y.isEmpty()&&!y.matches("\\d{4}")){setStatus("Укажи год четырьмя цифрами, например 1998.");return;}
        prefs.edit().putString("domain",origin()).apply(); pendingPage=-1;
        setStatus("Определяю страницы каталога…"); web.loadUrl(pageUrl(1));
    }
    String parserScript(){
        return "javascript:(function(){var cards=[],seen={};var ns=document.querySelectorAll('.b-content__inline_item');"+
        "for(var i=0;i<ns.length;i++){var n=ns[i],a=n.querySelector('a[href]');if(!a)continue;var u=a.href;if(seen[u])continue;seen[u]=1;var l=n.querySelector('.b-content__inline_item-link');cards.push({url:u,title:(l?l.innerText:a.innerText||'Без названия').trim()});}"+
        "var max=1,as=document.querySelectorAll('a[href]');for(var j=0;j<as.length;j++){var h=as[j].href,m=h.match(/\\/page\\/(\\d+)\\/?(?:\\?.*)?$/);if(m)max=Math.max(max,parseInt(m[1],10)||1);}return JSON.stringify({cards:cards,max:max});})()";
    }
    void handleParsed(String value){
        try{
            String raw=value;
            if(raw.startsWith("\"") && raw.endsWith("\"")) raw=(String)new JSONTokener(raw).nextValue();
            JSONObject r=new JSONObject(raw); int max=Math.max(1,r.optInt("max",1)); JSONArray cards=r.optJSONArray("cards");
            if(pendingPage<0){int page=1+(int)(Math.random()*max);if(page!=1){pendingPage=page;setStatus("Открываю случайную страницу "+page+" из "+max+"…");web.loadUrl(pageUrl(page));return;}}
            pendingPage=-1; pickFrom(cards);
        }catch(Exception e){setStatus("Ошибка чтения страницы: "+e.getMessage());}
    }
    void pickFrom(JSONArray cards){
        try{
            if(cards==null||cards.length()==0){setStatus("На странице не найдены карточки.");return;}
            HashSet<String> used=usedUrls(); ArrayList<JSONObject> candidates=new ArrayList<>();
            for(int i=0;i<cards.length();i++){JSONObject x=cards.getJSONObject(i);if(!used.contains(x.getString("url")))candidates.add(x);}
            if(candidates.isEmpty()){setStatus("На этой странице все фильмы уже выбраны. Попробуй ещё раз.");return;}
            JSONObject pick=candidates.get((int)(Math.random()*candidates.size()));String u=pick.getString("url");
            JSONObject record=new JSONObject();record.put("url",u);record.put("title",pick.optString("title","Без названия"));
            record.put("date",System.currentTimeMillis());record.put("domain",origin());
            library.put(record);saveLibrary();
            startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(u)));
            setStatus("Открыто и добавлено в базу: "+pick.optString("title","Без названия")+" · записей: "+library.length());
        }catch(Exception e){setStatus("Ошибка: "+e.getMessage());}
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
                .setNegativeButton("Отмена",null).setPositiveButton("Удалить",(a,b)->{library=new JSONArray();saveLibrary();setStatus("База очищена.");}).show())
            .setNegativeButton("Закрыть",null).show();
    }
    void openRandomSaved(){
        if(library.length()==0){setStatus("База пуста.");return;}
        JSONObject x=library.optJSONObject(new Random().nextInt(library.length()));
        if(x!=null){String u=x.optString("url","");if(!u.isEmpty())startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(u)));}
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
