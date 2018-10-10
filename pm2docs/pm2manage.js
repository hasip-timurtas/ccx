var pm2     = require('pm2')

var prcesNames = ['cry-db-depth', 'cry-mongo', 'cry-sell-kontrol']


function Basla(){
  pm2.connect(async (err) => {
    if (err) throw err
    pm2.restart(prcesNames[0], function() {});
    await sleep(30)
    pm2.restart(prcesNames[1], function() {});
    pm2.restart(prcesNames[2], function() {});
    /*
    var list = pm2.list((err2, list) => {
      
    })
    */
  
    console.log(pm2)
  })
}


function sleep (saniye) {
  return new Promise(resolve => setTimeout(resolve, saniye * 1000))
}

Basla()
setInterval(() => {
  Basla()
}, 1000 * 60 * 60 ); // 1 saatte bir çalışır.