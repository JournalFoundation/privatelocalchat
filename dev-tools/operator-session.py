#!/usr/bin/env python3
"""Create or fetch an opted-in development diagnostic session without logging credentials."""
import argparse
import json
from pathlib import Path
import urllib.request
import urllib.parse

BASE='https://dev.privatelocal.chat/api/debug/admin/sessions'
PRIVATE=Path('/root/.config/privatelocalchat')
parser=argparse.ArgumentParser()
parser.add_argument('command',choices=['new','read'])
parser.add_argument('--session-file',default=str(PRIVATE/'iphone-debug-session.json'))
parser.add_argument('--out')
args=parser.parse_args()
token=(PRIVATE/'debug-read-token').read_text().strip()
if args.command=='new':
 request=urllib.request.Request(BASE,method='POST',headers={'Authorization':'Bearer '+token,'User-Agent':'PrivateLocalChat-debug-operator'})
else:
 saved=json.loads(Path(args.session_file).read_text())
 request=urllib.request.Request(BASE+'/'+saved['id'],headers={'Authorization':'Bearer '+token,'User-Agent':'PrivateLocalChat-debug-operator'})
with urllib.request.urlopen(request,timeout=30) as response:
 data=json.load(response)
if args.command=='new':
 path=Path(args.session_file);path.write_text(json.dumps(data,indent=2)+'\n');path.chmod(0o600)
 print(data['receiver'])
else:
 events_by_id={event['id']:event for event in data.get('events',[])}
 while data.get('cursor'):
  url=BASE+'/'+saved['id']+'?'+urllib.parse.urlencode({'cursor':data['cursor']})
  request=urllib.request.Request(url,headers={'Authorization':'Bearer '+token,'User-Agent':'PrivateLocalChat-debug-operator'})
  with urllib.request.urlopen(request,timeout=30) as response:data=json.load(response)
  events_by_id.update({event['id']:event for event in data.get('events',[])})
 data={'id':saved['id'],'events':sorted(events_by_id.values(),key=lambda event:event['at'])}
 if args.out:Path(args.out).write_text(json.dumps(data,indent=2)+'\n')
 events=data.get('events',[])
 print(json.dumps({'events':len(events),'latest':events[-15:]},indent=2))
