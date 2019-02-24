function Basla(){
    setInterval(() => {
        VerileriDoldur()
        BuyHazirla()
    }, 5000);
    
}

function VerileriDoldur(){
    document.querySelector(".btn-lg.btn.btn-block.btn-danger.sell") // SELL BUTTON
    document.querySelector("#orderQty").value = 10   // QUANTİTY
}

function BuyHazirla(){
    document.querySelector(".orderBookTable.asks table tbody td").click() // buy limit ve stop price doldurmak için last ask price tıklıyoruz.
    if(!document.querySelector(".btn-lg.btn.btn-block.btn-success.buy").disabled){
        document.querySelector(".btn-lg.btn.btn-block.btn-success.buy").click()
    }
}
