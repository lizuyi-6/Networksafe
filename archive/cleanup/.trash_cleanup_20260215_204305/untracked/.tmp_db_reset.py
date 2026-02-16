import sqlite3
hashv = '$2a$12$jyEw8mYR8PupPsnJsu5PjeyKETMJmSHKNK3Iv0pNtV3qiFWXcOm.C'
conn=sqlite3.connect('/app/data/prod/newsecurity.db')
cur=conn.cursor()
cur.execute("update users set password_hash=? where email=?", (hashv, 'admin@fluxguard.dev'))
conn.commit()
print('updated', cur.rowcount)
print(conn.execute("select email,password_hash from users where email='admin@fluxguard.dev'").fetchone())
conn.close()
