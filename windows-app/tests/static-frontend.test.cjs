const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {validateFrontend}=require('../scripts/validate-frontend.cjs');
function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ponto-static-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));fs.writeFileSync(path.join(folder,'index.html'),'<script type="module" src="/app.js"></script>');fs.writeFileSync(path.join(folder,'app.js'),'console.log(1)');return folder;}
test('frontend estático completo é independente de node_modules',t=>{const folder=fixture(t);assert.equal(validateFrontend(folder).files,2);});
test('asset ausente, runtime Next e segredo interrompem validação',t=>{
 const folder=fixture(t);fs.unlinkSync(path.join(folder,'app.js'));assert.throws(()=>validateFrontend(folder),/ausente/);fs.writeFileSync(path.join(folder,'app.js'),'');
 for(const name of ['node_modules','.next','.env','email.key']){fs.mkdirSync(path.join(folder,name));assert.throws(()=>validateFrontend(folder),/privado/);fs.rmSync(path.join(folder,name),{recursive:true});}
});
test('index sem bundle e CDN obrigatória falham',t=>{const folder=fixture(t);fs.writeFileSync(path.join(folder,'index.html'),'<html/>');assert.throws(()=>validateFrontend(folder),/JavaScript/);fs.writeFileSync(path.join(folder,'index.html'),'<script src="https://cdn.example/app.js"></script>');assert.throws(()=>validateFrontend(folder),/externo/);});
