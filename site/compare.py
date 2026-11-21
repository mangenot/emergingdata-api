import html, re, sys, difflib, json
def norm(s):
    s = s.replace('<br/>', '<br>')
    s = html.unescape(s)
    return s
for iso in sys.argv[1:]:
    a = open(f'published/{iso}.html', encoding='utf-8').read()
    b = open(f'{iso}-profile.html', encoding='utf-8').read()
    a = a[a.index('<title>'):]
    # compare body (before DATA) and DATA JSON separately
    ab, bb = a.split('\nvar DATA = ')[0], b.split('\nvar DATA = ')[0]
    da, db = a.split('\nvar DATA = ')[1].split(';\n',1)[0], b.split('\nvar DATA = ')[1].split(';\n',1)[0]
    na, nb = norm(ab), norm(bb)
    if na == nb: print(iso, 'body identical')
    else:
        print(iso, 'body differs')
        for l in list(difflib.unified_diff(na.split('\n'), nb.split('\n'), lineterm='', n=0))[:40]:
            print('   ', l[:300])
    ja, jb = json.loads(da), json.loads(db)
    if ja == jb: print(iso, 'DATA identical')
    else:
        for k in ja:
            if ja[k] != jb.get(k):
                if isinstance(ja[k], dict):
                    for kk in ja[k]:
                        if ja[k][kk] != jb[k].get(kk): print('   DATA', k, kk, 'differs', str(ja[k][kk])[:150], '|', str(jb[k].get(kk))[:150])
                else: print('   DATA', k, 'differs')
