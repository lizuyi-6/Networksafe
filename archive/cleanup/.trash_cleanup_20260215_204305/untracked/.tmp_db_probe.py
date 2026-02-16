import sqlite3
conn=sqlite3.connect('/app/data/prod/newsecurity.db')
cur=conn.cursor()
tables=[r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print(tables)
for t in tables:
    low=t.lower()
    if any(k in low for k in ['auth','login','security','attempt','lock']):
        try:
            c=conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(t,c)
        except Exception as e:
            print(t,'ERR',e)
conn.close()
