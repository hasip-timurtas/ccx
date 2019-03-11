const Instagram = require('instagram-web-api')
const rp = require('request-promise')
const randomWords = require('random-words')

const client = new Instagram({ username: 'sosyal.bayii', password: 'karina3434+' })

class IgAutoUpload {
    async Basla(){
        while(true){
            await client.login()
            const hashTags = await this.GetHashTags()
            const randomNumber = Math.floor(Math.random() * 6) + 1 // 1-6 arası random sayı
            const photo = `http://keskinmedia.com/ig/${randomNumber}.jpg`
            const caption = 'DM US FOR MORE INFORMATION! ' + hashTags
            const result = await client.uploadPhoto({ photo, caption })
            var a = 1
            this.sleep(60 * 60 * 3) // 3 saatte bir 
        }
        
    }

    async GetHashTags(){
        const word = randomWords()
        const url = 'https://query.displaypurposes.com/tag/'+ word

        const result = await rp(url).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        if(result.results.length < 10 ){
            return this.GetHashTags()
        }
        const hastaghs = result.results.map(e=> "#"+e.tag).join(' ')
        return hastaghs
    }

    sleep (saniye) {
		return new Promise(resolve => setTimeout(resolve, saniye * 1000))
    }

}

const igAutoUpload = new IgAutoUpload()
igAutoUpload.Basla() 