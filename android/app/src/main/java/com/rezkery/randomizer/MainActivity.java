package com.rezkery.randomizer;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.*;
import org.json.*;
import java.util.*;

public class MainActivity extends Activity {
    EditText domain, year; Spinner type; TextView status; WebView web; Button random;
    android.content.SharedPreferences prefs;
    String[] types={"Все вместе","Только фильмы","Только сериалы","Только мультфильмы","Только аниме"};
    String[] genres={"","1","2","3","82"};
    int pendingPage=-1;

    @Override public void onCreate(Bundle b){
        super.onCreate(b); setContentView(R.layout.activity_main);
        domain=findViewById(R.id.domain); year=findViewById(R.id.year); type=findViewById(R.id.type);
        status=findViewById(R.id.status); web=findViewById(R.id.web); random=findViewById(R.id.random);
        prefs=getSharedPreferences("rzk",0);
        domain.setText(prefs.getString("domain","https://rezkery.com"));
        type.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,types));
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String u){
                v.evaluateJavascript(parserScript(), value -> handleParsed(value));
            }
        });
        random.setOnClickListener(v->startRandom());
    }

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
        prefs.edit().putString("domain",origin()).apply(); pendingPage=-1;
        status.setText("Определяю страницы…"); web.loadUrl(pageUrl(1));
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
            if(pendingPage<0){
                int page=1+(int)(Math.random()*max);
                if(page!=1){pendingPage=page;status.setText("Открываю случайную страницу "+page+" из "+max+"…");web.loadUrl(pageUrl(page));return;}
            }
            pendingPage=-1; pickFrom(cards);
        }catch(Exception e){status.setText("Ошибка чтения страницы: "+e.getMessage());}
    }
    void pickFrom(JSONArray cards){
        try{
            if(cards==null || cards.length()==0){status.setText("На странице не найдены карточки.");return;}
            HashSet<String> used=new HashSet<>(); String saved=prefs.getString("used","");
            if(!saved.isEmpty()){JSONArray a=new JSONArray(saved);for(int i=0;i<a.length();i++)used.add(a.getString(i));}
            ArrayList<JSONObject> candidates=new ArrayList<>();
            for(int i=0;i<cards.length();i++){JSONObject x=cards.getJSONObject(i);if(!used.contains(x.getString("url")))candidates.add(x);}
            if(candidates.isEmpty()){status.setText("Все карточки этой страницы уже были использованы.");return;}
            JSONObject pick=candidates.get((int)(Math.random()*candidates.size())); String u=pick.getString("url");
            used.add(u); JSONArray nu=new JSONArray(); for(String x:used)nu.put(x);
            prefs.edit().putString("used",nu.toString()).apply();
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
            status.setText("Открыто: "+pick.optString("title","Без названия"));
        }catch(Exception e){status.setText("Ошибка: "+e.getMessage());}
    }
}
