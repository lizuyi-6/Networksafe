const line = '::1 - - [22/Feb/2026:17:15:36 +0800] "GET / HTTP/1.1" 301 162 "-" "curl/7.61.1"';
const combinedLogRegex = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d+) \S+ "[^"]*" "([^"]*)"/;
const match = line.match(combinedLogRegex);
console.log(match ? 'MATCHED: ' + match[1] : 'NO MATCH');
