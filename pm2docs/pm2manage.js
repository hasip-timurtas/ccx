var pm2     = require('pm2')

var prcesNames = ['deneme']


function Basla(){
  pm2.connect(async (err) => {
    if (err) throw err
    for (const prces of prcesNames) {
      pm2.stop(prces, function() {});
      pm2.start(process, function(){})
      console.log(prces + ' Başladı.')
    }
    //var list = pm2.list((err2, list) => {})
  })
}


function sleep (saniye) {
  return new Promise(resolve => setTimeout(resolve, saniye * 1000))
}

Basla()
setInterval(() => {
  Basla()
}, 1000 * 60 * 60 ); // 1 saatte bir çalışır.