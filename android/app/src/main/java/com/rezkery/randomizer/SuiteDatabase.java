package com.rezkery.randomizer;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import org.json.*;
import java.util.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Suite metadata is indexed in SQLite; image payloads are separate private files. */
final class SuiteDatabase extends SQLiteOpenHelper {
    private static final Set<String> STORES=new HashSet<>(Arrays.asList("movies","aliases","catalogs","memberships","userState","collections","tags","history","assets","jobs","settings","tombstones","staging","details"));
    private final File media;
    SuiteDatabase(Context c){super(c,"rezka-suite-v1.db",null,1);media=new File(c.getFilesDir(),"suite-media");media.mkdirs();}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE records(store TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(store,id))");
        db.execSQL("CREATE TABLE movie_index(id TEXT PRIMARY KEY,title TEXT,year INTEGER,type TEXT,search TEXT,status TEXT,rating REAL,siteRating REAL,addedAt INTEGER,updatedAt INTEGER)");
        for(String column:Arrays.asList("title","year","type","status","rating","siteRating","addedAt"))db.execSQL("CREATE INDEX movie_"+column+" ON movie_index("+column+")");
        db.execSQL("CREATE TABLE member_index(id TEXT PRIMARY KEY,parentId TEXT,movieId TEXT)");
        db.execSQL("CREATE INDEX member_parent ON member_index(parentId,movieId)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int old,int next){throw new IllegalStateException("Неизвестная версия базы Suite");}
    private String store(JSONObject c)throws Exception{String s=c.getString("store");if(!STORES.contains(s))throw new Exception("Неизвестный раздел базы");return s;}
    private String fileKey(String id)throws Exception{byte[] b=java.security.MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte x:b)out.append(String.format("%02x",x&255));return out.toString();}
    private void writePayload(String name,String data)throws Exception{File f=new File(media,name),temp=new File(media,name+".tmp");try(FileOutputStream out=new FileOutputStream(temp)){out.write(data.getBytes(StandardCharsets.UTF_8));}if(!temp.renameTo(f))throw new IOException("Не удалось сохранить постер");}
    private String readPayload(String name)throws Exception{if(!name.matches("[a-f0-9]{64}"))throw new IOException("Некорректный ключ медиа");File f=new File(media,name);try(InputStream in=new FileInputStream(f);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    private JSONObject hydrate(JSONObject row)throws Exception{if(row.has("__suiteFile")){row.put("data",readPayload(row.getString("__suiteFile")));row.remove("__suiteFile");}JSONObject child=row.optJSONObject("row");if(child!=null&&child.has("__suiteFile"))hydrate(child);return row;}
    private JSONObject one(String store,String id)throws Exception{try(Cursor c=getReadableDatabase().rawQuery("SELECT json FROM records WHERE store=? AND id=?",new String[]{store,id})){return c.moveToFirst()?hydrate(new JSONObject(c.getString(0))):null;}}
    private JSONArray rows(String sql,List<String> args)throws Exception{JSONArray out=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery(sql,args.toArray(new String[0]))){while(c.moveToNext())out.put(hydrate(new JSONObject(c.getString(0))));}return out;}
    synchronized Object command(JSONObject c)throws Exception{
        String op=c.getString("op");SQLiteDatabase db=getWritableDatabase();
        if(op.equals("batch")){JSONArray values=c.getJSONArray("rows");List<File> removedFiles=new ArrayList<>();db.beginTransaction();try{for(int i=0;i<values.length();i++){JSONArray v=values.getJSONArray(i);String s=v.getString(0);if(!STORES.contains(s))throw new Exception("Неизвестный раздел");JSONObject row=new JSONObject(v.getJSONObject(1).toString());String id=row.getString("id");row.remove("__suiteFile");if(row.optJSONObject("row")!=null)row.getJSONObject("row").remove("__suiteFile");if(v.optBoolean(2)){if(s.equals("staging"))removedFiles.add(new File(media,fileKey(s+id)));db.delete("records","store=? AND id=?",new String[]{s,id});if(s.equals("movies"))db.delete("movie_index","id=?",new String[]{id});if(s.equals("memberships"))db.delete("member_index","id=?",new String[]{id});if(s.equals("assets"))removedFiles.add(new File(media,fileKey(s+id)));continue;}
            JSONObject payload=s.equals("assets")?row:s.equals("staging")&&row.optString("store").equals("assets")?row.optJSONObject("row"):null;
            if(payload!=null&&payload.has("data")){String key=fileKey(s+id);writePayload(key,payload.getString("data"));payload.remove("data");payload.put("__suiteFile",key);}
            ContentValues content=new ContentValues();content.put("store",s);content.put("id",id);content.put("json",row.toString());db.insertWithOnConflict("records",null,content,SQLiteDatabase.CONFLICT_REPLACE);
            if(s.equals("movies")){ContentValues index=new ContentValues();index.put("id",id);for(String field:Arrays.asList("title","type","search","status"))index.put(field,row.optString(field));for(String field:Arrays.asList("year","rating","siteRating","addedAt","updatedAt"))index.put(field,row.optDouble(field,0));db.insertWithOnConflict("movie_index",null,index,SQLiteDatabase.CONFLICT_REPLACE);}
            if(s.equals("memberships")){ContentValues index=new ContentValues();index.put("id",id);index.put("parentId",row.optString("parentId"));index.put("movieId",row.optString("movieId"));db.insertWithOnConflict("member_index",null,index,SQLiteDatabase.CONFLICT_REPLACE);}
        }db.setTransactionSuccessful();}finally{db.endTransaction();}for(File file:removedFiles)file.delete();return true;}
        if(op.equals("get"))return one(store(c),c.getString("id"));
        if(op.equals("getMany")){String s=store(c);JSONArray ids=c.getJSONArray("ids"),out=new JSONArray();for(int i=0;i<ids.length();i++)out.put(one(s,ids.getString(i)));return out;}
        if(op.equals("count")){try(Cursor cur=db.rawQuery("SELECT count(*) FROM records WHERE store=?",new String[]{store(c)})){cur.moveToFirst();return cur.getLong(0);}}
        if(op.equals("page")||op.equals("prefix")){String s=store(c),after=c.optString("after","");int limit=Math.max(1,Math.min(200,c.optInt("limit",100)));String where="store=? AND id>?";List<String> args=new ArrayList<>(Arrays.asList(s,after));if(op.equals("prefix")){String p=c.getString("prefix");where+=" AND id>=? AND id<=?";args.add(p);args.add(p+"\uffff");if(p.contains(":assets:"))limit=1;}if(s.equals("assets"))limit=1;args.add(String.valueOf(limit));return rows("SELECT json FROM records WHERE "+where+" ORDER BY id LIMIT ?",args);}
        if(op.equals("children"))return rows("SELECT r.json FROM records r JOIN member_index m ON r.id=m.id WHERE r.store='memberships' AND m.parentId=?",Arrays.asList(c.getString("parentId")));
        if(op.equals("links"))return rows("SELECT r.json FROM records r JOIN member_index m ON r.id=m.id WHERE r.store='memberships' AND m.movieId=?",Arrays.asList(c.getString("movieId")));
        if(op.equals("query")){JSONObject f=c.getJSONObject("filters");StringBuilder where=new StringBuilder("r.store='movies'");List<String> args=new ArrayList<>();for(String k:Arrays.asList("year","type","status")){String v=f.optString(k,"");if(!v.isEmpty()){where.append(" AND m.").append(k).append("=?");args.add(v);}}
            String q=f.optString("q","").toLowerCase(new Locale("ru")).replace('ё','е');for(String word:q.split("\\s+"))if(!word.isEmpty()){where.append(" AND m.search LIKE ? ESCAPE '\\'");args.add("%"+word.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%");}
            if(!f.optString("parent").isEmpty()){where.append(" AND EXISTS(SELECT 1 FROM member_index x WHERE x.movieId=m.id AND x.parentId=?)");args.add(f.getString("parent"));}
            String sort=f.optString("sort","addedAt");if(!Arrays.asList("title","year","siteRating","rating","addedAt").contains(sort))sort="addedAt";int limit=Math.max(1,Math.min(100,f.optInt("limit",60)));args.add(String.valueOf(limit+1));args.add(String.valueOf(Math.max(0,f.optInt("offset",0))));JSONArray out=rows("SELECT r.json FROM records r JOIN movie_index m ON r.id=m.id WHERE "+where+" ORDER BY m."+sort+(sort.equals("title")?" ASC":" DESC")+",m.id LIMIT ? OFFSET ?",args);boolean more=out.length()>limit;if(more)out.remove(out.length()-1);return new JSONObject().put("items",out).put("hasMore",more);}
        throw new Exception("Неизвестная операция базы");
    }
}
