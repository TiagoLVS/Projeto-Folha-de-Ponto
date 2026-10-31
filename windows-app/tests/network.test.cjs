const {test}=require('node:test');const assert=require('node:assert/strict');
const {connection,verifyCertificate}=require('../app/network.cjs');
const {privateAddress}=require('../app/host.cjs');
test('conexão da equipe exige HTTPS e impressão digital válida',()=>{
 const fingerprint='ab'.repeat(32);
 assert.deepEqual(connection({url:'https://192.168.1.20:5173',fingerprint}),{url:'https://192.168.1.20:5173',fingerprint});
 for(const url of ['http://192.168.1.20:5173','https://user:password@192.168.1.20','https://servidor/qualquer','https://servidor/?senha=secreta'])assert.throws(()=>connection({url,fingerprint}));
 assert.throws(()=>connection({url:'https://servidor',fingerprint:'invalido'}));
 assert.equal(verifyCertificate('invalido',fingerprint),false);
});
test('gateway permite somente endereços privados e loopback',()=>{
 for(const value of ['127.0.0.1','::1','192.168.2.4','::ffff:10.1.2.3','172.16.2.4','172.31.2.4','fd00::1234'])assert.equal(privateAddress(value),true,value);
 for(const value of ['8.8.8.8','172.32.0.1','172.15.0.1','2001:4860:4860::8888',undefined])assert.equal(privateAddress(value),false,String(value));
});
