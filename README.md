# MIOLight Configurator

Prototipo web per guidare l'operatore nella configurazione visuale di un prodotto MIO/Pigreco, dal caricamento del modello GLB alla pubblicazione.

## Avvio

Online: https://giamp72.github.io/MIOLight_Configurator/ (GitHub Pages). In locale: avvia un server statico nella cartella, ad esempio `python3 -m http.server 4173`. Three.js è incluso in `vendor/`, nessuna installazione necessaria.

Il prototipo usa dati dimostrativi: la ricerca prodotti, le opzioni compatibili e la pubblicazione non sono ancora collegate alle API MIO/Pigreco. Le bozze e il modello GLB vengono salvati localmente nel browser.

## Flusso

1. Seleziona un prodotto già presente nell'anagrafica dimostrativa.
2. Carica un file GLB e controlla le mesh nel visualizzatore.
3. Definisci gli attributi, il numero di opzioni e, per ogni opzione, codice, descrizione, materiale del GLB (facoltativo) e anteprima JPG.
4. Classifica ogni mesh come fissa o variabile e collegala a un attributo.
5. Applica i default sorgente e conferma i controlli manuali del test.
6. Esamina gli errori bloccanti e pubblica la configurazione.

La pubblicazione è impedita se la configurazione non supera i controlli automatici.
