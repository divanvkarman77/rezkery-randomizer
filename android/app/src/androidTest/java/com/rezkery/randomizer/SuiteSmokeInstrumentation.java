package com.rezkery.randomizer;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import org.json.*;
import java.util.concurrent.*;

/** Runs against an isolated emulator. No real site or account is contacted. */
public final class SuiteSmokeInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle b){super.onCreate(b);start();}
    void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    String js(SuiteActivity a,String expression)throws Exception{CountDownLatch latch=new CountDownLatch(1);String[] result={null};runOnMainSync(()->a.view.evaluateJavascript(expression,value->{result[0]=value;latch.countDown();}));if(!latch.await(10,TimeUnit.SECONDS))throw new Exception("WebView callback timed out");return result[0];}
    @Override public void onStart(){Bundle result=new Bundle();SuiteActivity activity=null;try{
        SuiteDatabase db=new SuiteDatabase(getTargetContext());long started=System.currentTimeMillis();StringBuilder measurements=new StringBuilder();
        for(int size=0;size<100000;size+=500){JSONArray rows=new JSONArray();for(int n=size;n<size+500;n++){JSONObject m=new JSONObject().put("id","rezka:"+(1000000+n)).put("url","https://rezka.fi/films/"+(1000000+n)+"-synthetic.html").put("title","Synthetic "+n).put("search","synthetic "+n).put("year",1980+n%40).put("type",n%4==0?"series":"film").put("status","").put("rating",0).put("addedAt",n);rows.put(new JSONArray().put("movies").put(m));}db.command(new JSONObject().put("op","batch").put("rows",rows));if(size+500==10000||size+500==50000||size+500==100000){long t=System.currentTimeMillis();JSONObject page=(JSONObject)db.command(new JSONObject().put("op","query").put("filters",new JSONObject().put("year","1990").put("q","synthetic").put("type","film").put("limit",60)));check(page.getJSONArray("items").length()==60,"SQLite filtered page");measurements.append(size+500).append(" records: query ").append(System.currentTimeMillis()-t).append(" ms; ");}}
        JSONObject user=new JSONObject().put("id","rezka:1000000").put("note","Проверка заметки");db.command(new JSONObject().put("op","batch").put("rows",new JSONArray().put(new JSONArray().put("userState").put(user))));check(((JSONObject)db.command(new JSONObject().put("op","get").put("store","userState").put("id",user.getString("id")))).getString("note").equals("Проверка заметки"),"SQLite note roundtrip");db.close();
        Intent i=new Intent(getTargetContext(),SuiteActivity.class);i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=(SuiteActivity)startActivitySync(i);boolean ready=false;for(int n=0;n<40;n++){Thread.sleep(500);String value=js(activity,"JSON.stringify({stats:document.querySelector('#stats')?.textContent,message:document.querySelector('#message')?.textContent,cards:document.querySelectorAll('#cards .movie').length,bridge:typeof RezkaNative})");Object decoded=new JSONTokener(value).nextValue();if(decoded instanceof String){JSONObject state=new JSONObject((String)decoded);check(!state.optString("message").startsWith("Не удалось"),state.optString("message"));if(state.optInt("cards")==60){check(state.getString("stats").contains("100000"),"Native UI count");ready=true;break;}}}check(ready,"Native WebView library did not render");
        js(activity,"document.querySelector('[data-tab=files]').click();document.querySelector('#theme').click();true");check(js(activity,"document.querySelector('#files').hidden").equals("false"),"Native navigation");
        result.putString("stream","SUITE_SMOKE_OK · "+measurements+" total "+(System.currentTimeMillis()-started)+" ms\n");finish(Activity.RESULT_OK,result);
    }catch(Throwable e){result.putString("stream","SUITE_SMOKE_FAILED: "+e+"\n");finish(Activity.RESULT_CANCELED,result);}finally{if(activity!=null){SuiteActivity current=activity;runOnMainSync(current::finish);}}}
}
