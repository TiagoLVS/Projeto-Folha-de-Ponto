const buttons=[...document.querySelectorAll('button')];
window.setup.onStatus(text=>{document.querySelector('#status').textContent=text;if(text.includes('✓')){const item=document.createElement('li');item.textContent=text;document.querySelector('#progress').append(item);}});
for(const button of buttons)button.addEventListener('click',async()=>{
 buttons.forEach(item=>item.disabled=true);document.querySelector('#status').textContent='Preparando o sistema. Aguarde…';
 try{const result=await window.setup.start(button.id);if(result?.error)document.querySelector('#status').textContent=result.error;else if(result?.cancelled)document.querySelector('#status').textContent='Seleção cancelada.';}
 catch{document.querySelector('#status').textContent='Não foi possível preparar o sistema. Confira o arquivo de conexão e tente novamente.';}
 finally{buttons.forEach(item=>item.disabled=false);}
});
