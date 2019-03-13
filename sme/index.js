const Instagram = require('instagram-web-api')
const rp = require('request-promise')
const randomWords = require('random-words')
const FileCookieStore = require('tough-cookie-filestore2')
const cookieStore = new FileCookieStore('./cookies.json')
const kariHashTags = `
#nycnewbornphotographer #nyctattoo #nycbrides #nycrealestate #nycbarber #nychotel #nycstore #nycbrand #nycrestaurants #nycbars #nycphotoshoot #nycnews #nycextensions #plasticsurgerynyc #nycsinger #nycfitness #nycpainters #nycdancers #nycweddings #nycweddingphotography
#neworleansnails #delawarehairstylist #delawarebraider #ohiomakeupartist #ohiophotographer #georgiarealestate #ohiorealestate #nycrealestate #miamirealestate #miamibraider #washingtonrealestate #ukrealestate #ukbride #nycbrides #makeupturorial #beautybloggerlife #professionalorganizer #luxuryweddingplanner #weddingplannermalaysia #weddingplannermadrid #personaltrainerdubai
#nycmodel #nycactress #newyorkinfluencers #miamiinfluencer #miamimodel #springseason #newarrivalsdaily #fashionphotographerdubai #dubaimodel #dubaiinfluencers #abudhabiinfluencer #dubailifestyle #dubaihorses #dubaiwriters #dubaiphotography #photographer_pics #nycphotographers #washington_ig #nycmodels
#disoverysection #nychairdresser #makeupnyc #newjerseybraider #newjerseymodel #newjerseyfitness #ohiobarbers #minnesotabarbers #ohiofitness #ohiomakeupartist #arizonabarbers #arkansasfitness #coloradobarber #mainemodel #mainemakeupartist #massachusettsphotography #hampshiremakeupartist #michiganfitness #carolinabarber #nycbridalmarket
#alabamabarker #alabamaweddingplanner #alabamashop #alaskaphotography #alaskabarbershop #alaskashop #arizonabarber #arizonagardening #arizonatattooshop #yogaarizona #arkansasyoga #nycyoga #nebraskacornhuskers #njyoga #arkansasbarber #arkansasstyle #arizonastyle #delawarestateuniversity #delawareyoga #fitnessusa #usafitness #nutricionistasp #healthcoachnyc #healthcoachinstitute #youthcoaching #topmodelschool #plasticsurgerykorea #plasticsurgerycolombia #plasticsurgerybeforeandafter #sellinghomes
#newbornphotographerargentina #newbornphotographersydney #newbornphotographermelbourne #newbornphotographerdubai #weddingplannerdubai #partyplannerdubai #dubaibar #hawaiibar #hawaiinightclubs #surfschoolbali #surfschoollanzarote #surfschooltenerife #healthysmoothies #cookeryschool #njchef #louisianarestaurant #missourirestaurants #nevadashoes #nevadajeans #newmexicoart
`.replace(/\s/g, '').split('#')
kariHashTags.shift()


class IgAutoUpload {
    async Basla(){
        let sayac = 1
        while(true){
            //const client = new Instagram({ username: 'sosyal.bayii', password: 'karina3434+', cookieStore  })
            //const client = new Instagram({ username: 'social.media.tips_', password: 'hello560', cookieStore  })
            const client = new Instagram({ username: 'social.media.improvment', password: 'hasip3535', cookieStore  })
            await client.login()
            const profile = await client.getProfile()
            console.log(profile.email);
            const hashTagList = this.GetRamdom30Tags() //await this.GetHashTags()
            const hashTags = hashTagList.join(" #")
            const randomNumber = Math.floor(Math.random() * 16)  // 1-6 arası random sayı
            const photo = `http://keskinmedia.com/ig/${randomNumber}.jpg`
            const caption = 'DM US FOR MORE INFORMATION! #' + hashTags
            const result = await client.uploadPhoto({ photo, caption })
            if(result.status == "ok"){
                console.log(sayac + " defa resim Yüklendi")
                sayac++
            }else{
                console.log("Resim yüklerken hata oluştu. tekrar deneyecek")
            }
            await this.sleep(60 * 60 * 3) // 3 saatte bir 
        }
        
    }

    GetRamdom30Tags(){
        var arr = kariHashTags
        var result = []
        var _tmp = arr.slice()
        for(var i = 0; i<30; i++){
          var index = Math.ceil(Math.random() * 10) % _tmp.length
          result.push(_tmp.splice(index, 1)[0])
        }
        return result
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