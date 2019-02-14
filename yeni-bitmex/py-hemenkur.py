from bitmex_websocket import BitMEXWebsocket
import logging
from time import sleep
import bitmex
import _thread
client = bitmex.bitmex(test=False, api_key="WUi67Xl7EjE6A0iUq1RFVENw", api_secret="9alw1YOYGOlMrvW6N6AEC5ulmUl9ZKIP4a2RSdCQvs_xQCCn")
AMOUNT = 10

# Basic use of websocket.
def run():
    global client, AMOUNT   
    firstBuy = 0
    oncekiBuy = 0

    firstSell = 0
    oncekiSell = 0
    
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
        print(firstBuy, firstSell)
        #_thread.start_new_thread( hemenOrderKur, () )
        #hemenOrderKur()
       # logger.info(orderBook)
        


def buyKontrol(firstSell, oncekiSell):
    if oncekiSell == 0:
        oncekiSell = firstSell
    elif firstSell < oncekiSell:
        print('Sell Fiat Düştü')
        tempOnceki = oncekiSell
        oncekiSell = firstSell
        # Oncekileri boz
        #client.Order.Order_cancelAll().result()
        #SELL KUR
        order = client.Order.Order_new(symbol='XBTUSD', side="Sell", orderQty=AMOUNT, price=firstSell).result()
        print("Sell kuruldu. Önceki price: "+ str(tempOnceki)+", şimdiki price: "+ str(firstSell))
        sonraOrderBoz(order['OrderId'])
    else:
        oncekiSell = firstSell

def sellKontrol(firstSell, oncekiSell):
    if oncekiSell == 0:
        oncekiSell = firstSell
    elif firstSell < oncekiSell:
        print('Sell Fiat Düştü')
        tempOnceki = oncekiSell
        oncekiSell = firstSell
        # Oncekileri boz
        #client.Order.Order_cancelAll().result()
        #SELL KUR
        order = client.Order.Order_new(symbol='XBTUSD', side="Sell", orderQty=AMOUNT, price=firstSell).result()
        print("Sell kuruldu. Önceki price: "+ str(tempOnceki)+", şimdiki price: "+ str(firstSell))
        sonraOrderBoz(order['OrderId'])
    else:
        oncekiSell = firstSell

def sonraOrderBoz(orderId):
    global client
    sleep(60)
    client.Order.Order_cancel(orderID=orderId).result()

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

if __name__ == "__main__":
    run()


