#!/usr/bin/env bash
# 真机验证脚本：自动换源 / 离线缓存 / WebDAV 同步音源
# 用法: bash scripts/verify-features.sh <阶段>
#   阶段: play | cache | nosync | all
set -u
export PATH="/Users/zhanxw/Library/Android/sdk/platform-tools:$PATH"
APPDIR=/data/data/cn.toside.music.mobile
PKG=cn.toside.music.mobile

log(){ echo "[$(date +%H:%M:%S)] $*"; }
shot(){ adb exec-out screencap -p > "/tmp/ui_$1.png" 2>/dev/null; }
dump(){ adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1; }
texts(){ /Users/zhanxw/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -c "
import re,sys
xml=open('/tmp/ui.xml',encoding='utf-8').read()
out=[]
for m in re.finditer(r'<node[^>]*>',xml):
    s=m.group(0)
    t=re.search(r'text=\"([^\"]*)\"',s)
    if t and t.group(1).strip(): out.append(t.group(1))
print(' | '.join(out))
"; }

# 读取设置
read_setting(){
  rm -rf /tmp/vs && mkdir -p /tmp/vs && cd /tmp/vs
  for f in AsyncStorage AsyncStorage-wal AsyncStorage-shm; do
    adb shell run-as $PKG cat $APPDIR/databases/$f > $f 2>/dev/null
  done
  /Users/zhanxw/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -c "
import sqlite3,json
con=sqlite3.connect('/tmp/vs/AsyncStorage')
d=dict(con.execute('SELECT key,value FROM Storage').fetchall())
s=json.loads(d.get('@setting_v1','{}'))
for k in ('common.apiSource','common.isEnableOfflineCache','sync.webdav.syncUserApi','player.isEnableAudioOffload'):
    print(f'{k}={s.get(k)}')
lst=json.loads(d.get('@user_api__') or '[]')
print('userApiCount=%d' % len(lst))
for i in lst: print('  api:', i.get('id'), '|', i.get('name'))
oc=d.get('@offline_cache__')
print('offlineCacheIndex=%d' % (len(json.loads(oc)) if oc else 0))
"
  cd - >/dev/null
}

# 写设置
write_setting(){
  # $1 = python 表达式, 在 setting 字典上执行
  rm -rf /tmp/vs && mkdir -p /tmp/vs && cd /tmp/vs
  for f in AsyncStorage AsyncStorage-wal AsyncStorage-shm; do
    adb shell run-as $PKG cat $APPDIR/databases/$f > $f 2>/dev/null
  done
  /Users/zhanxw/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -c "
import sqlite3,json,sys
con=sqlite3.connect('/tmp/vs/AsyncStorage')
d=dict(con.execute('SELECT key,value FROM Storage').fetchall())
s=json.loads(d['@setting_v1'])
$1
con.execute('UPDATE Storage SET value=? WHERE key=?',(json.dumps(s,ensure_ascii=False),'@setting_v1'))
con.commit(); con.execute('PRAGMA wal_checkpoint(TRUNCATE)'); con.close()
print('setting updated')
"
  adb push AsyncStorage /data/local/tmp/AsyncStorage >/dev/null 2>&1
  adb shell chmod 644 /data/local/tmp/AsyncStorage
  adb shell run-as $PKG cp /data/local/tmp/AsyncStorage databases/AsyncStorage
  adb shell run-as $PKG rm -f databases/AsyncStorage-wal databases/AsyncStorage-shm
  cd - >/dev/null
}

open_list(){ adb shell input tap 69 129 >/dev/null 2>&1; sleep 2.5; adb shell input tap 246 898 >/dev/null 2>&1; sleep 3; }
play_song(){ adb shell input tap 490 "$1" >/dev/null 2>&1; }
cache_files(){ adb shell run-as $PKG ls -la $APPDIR/files/OfflineCache/ 2>/dev/null | tail -n +2 | wc -l; }

case "${1:-all}" in
  settings) read_setting ;;
  *) echo "用法: $0 settings" ;;
esac
