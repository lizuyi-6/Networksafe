import sqlite3
conn=sqlite3.connect('/app/data/prod/newsecurity.db')
row=conn.execute("select email,password_hash from users where email='admin@fluxguard.dev'").fetchone()
print(row)
conn.close()
