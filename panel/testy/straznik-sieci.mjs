// Ładowany przez --import w procesie panelu (testy/pokaz.test.mjs): każde połączenie wychodzące
// i każde zapytanie DNS o nazwę zapisuje na stderr jako „POLACZENIE-WYCHODZACE …”. Nasłuch serwera
// (listen na 0.0.0.0 też woła dns.lookup, ale z adresem IP) tu nie trafia.
import net from 'node:net';
import dns from 'node:dns';

const zglos = co => process.stderr.write('POLACZENIE-WYCHODZACE ' + co + '\n');
const nazwa = host => !net.isIP(String(host));
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) { zglos('connect ' + JSON.stringify(a[0]?.host ?? a[1] ?? a[0])); return connect.apply(this, a); };
const lookup = dns.lookup;
dns.lookup = function (host, ...a) { if (nazwa(host)) zglos('dns ' + host); return lookup.call(this, host, ...a); };
const lookupP = dns.promises.lookup;
dns.promises.lookup = function (host, ...a) { if (nazwa(host)) zglos('dns ' + host); return lookupP.call(this, host, ...a); };
