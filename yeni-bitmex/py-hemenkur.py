from bitmex_websocket import BitMEXWebsocket
import logging
from time import sleep
import bitmex

client = bitmex.bitmex(test=False, api_key="WUi67Xl7EjE6A0iUq1RFVENw", api_secret="9alw1YOYGOlMrvW6N6AEC5ulmUl9ZKIP4a2RSdCQvs_xQCCn")
AMOUNT = 10
firstBuy = 0
oncekiBuy = 0

firstSell = 0
oncekiSell = 0
# Basic use of websocket.
def run():
    global firstBuy, firstSell
    
    #logger = setup_logger()

    # Instantiating the WS will make it connect. Be sure to add your api_key/api_secret.
    ws = BitMEXWebsocket(endpoint="wss://www.bitmex.com/realtime", symbol="XBTUSD",
                         api_key="9XeRFuMri_7VoF1Dtd-MT_aY", api_secret="DT4615ZUSR25CqoEyimai1EeK_U-hipSWoCsZREWIEQM9NVV")

    #ws.get_instrument()

    # Run forever
    while(ws.ws.sock.connected):
        orderBook = ws.market_depth()
        firstSell = orderBook[0]["asks"][0][0]
        firstBuy = orderBook[0]["bids"][0][0]
        hemenOrderKur()
       # logger.info(orderBook)

def hemenOrderKur():
    global oncekiBuy, oncekiSell, AMOUNT, client, firstBuy, firstSell
    if oncekiSell == 0:
        oncekiSell = firstSell
    elif firstSell < oncekiSell:
        print('Sell Fiat Düştü')
        tempOnceki = oncekiSell
        oncekiSell = firstSell
        #SELL KUR
        order = client.Order.Order_new(symbol='XBTUSD', side="Buy", orderQty=AMOUNT, price=firstSell).result()
        print(order)
        print("Sell kuruldu. Önceki price: "+ str(tempOnceki)+", şimdiki price: "+ str(firstSell))
            
    else:
        oncekiSell = firstSell
        
    if oncekiBuy == 0:
        oncekiBuy = firstBuy
    elif firstBuy > oncekiBuy:
        print('BUY Fiat ÇIKTI')
        tempOnceki = oncekiBuy
        oncekiBuy = firstBuy
        #SELL KUR
        order = client.Order.Order_new(symbol='XBTUSD', side="Sell", orderQty=AMOUNT, price=firstBuy).result()
        print(order)
        print("Buy kuruldu. Önceki price: "+str(tempOnceki)+", şimdiki price: "+ str(firstBuy))
    else:
        oncekiBuy = firstBuy
    

'''
    # Run forever
    while(ws.ws.sock.connected):
        logger.info("Ticker: %s" % ws.get_ticker())
        if ws.api_key:
            logger.info("Funds: %s" % ws.funds())
        logger.info("Market Depth: %s" % ws.market_depth())
        logger.info("Recent Trades: %s\n\n" % ws.recent_trades())
        sleep(10)
'''

def setup_logger():
    # Prints logger info to terminal
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)  # Change this to DEBUG if you want a lot more info
    ch = logging.StreamHandler()
    # create formatter
    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    # add formatter to ch
    ch.setFormatter(formatter)
    logger.addHandler(ch)
    return logger


if __name__ == "__main__":
    run()


