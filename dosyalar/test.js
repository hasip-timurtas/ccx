const Ortak = require('./ortak')
 const { auth, db, dbf } =  require('./firebase')

class Testler {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables()
        await auth.signInWithEmailAndPassword('hasip.timurtas@gmail.com', 'Hasip3434+')
    }

    async Basla(){
        await this.LoadVeriables()
        let t = process.hrtime();
        await this.ortak.depths.findOne({market: 'LTC/BTC'})
        await this.ortak.sleep(1)
        t = process.hrtime(t);
        console.log(`${t[0]} second ${t[1]} milisecond`);

        console.time('mongo')
        await this.ortak.depths.findOne({market: 'LTC/BTC'})
        console.timeEnd('mongo')

        console.time('fb')
        const data = await dbf.collection('Notes').doc('rxKmu3rbFMWJvCxtGf71tnZckYg1').get()
        .then((snapshot) => {
            return snapshot.data()
        })
        .catch((err) => {
            console.log('Error getting documents', err);
        });

        console.timeEnd('fb')
    }

}

const testler = new Testler()
testler.Basla()
