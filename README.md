# MIOLight Configurator

Prototipo web autonomo per preparare prodotti configurabili MIO Light: archivio condiviso di attributi e opzioni, anagrafiche prodotto, importazione GLB, azioni dichiarative sulle mesh, condizioni, controlli e versioni pubblicate.

## Avvio

Online: https://giamp72.github.io/MIOLight_Configurator/ (GitHub Pages). In locale, avvia un server statico nella cartella, ad esempio `python3 -m http.server 4173`, quindi apri `http://localhost:4173`. Non sono necessarie installazioni: bozze, modelli GLB e snapshot sono conservati in IndexedDB nel browser.

## Flusso operatore

1. Crea e riutilizza attributi e opzioni nell’archivio condiviso, anche partendo da un catalogo vuoto.
2. Registra un prodotto MIO Light e carica il GLB. L’applicazione legge il grafo e mostra le mesh con percorso univoco, senza viewer 3D.
3. Assegna gli attributi al prodotto, limita le opzioni ammesse e definisci i default.
4. Per ciascuna opzione aggiungi azioni `MOSTRA`, `NASCONDI` o `APPLICA MATERIALE`, riferite a una o più mesh.
5. Definisci dipendenze semplici tra attributi e correggi conflitti, mesh mancanti e altri errori bloccanti.
6. Salva la bozza in qualsiasi momento, esporta il payload JSON e pubblica una versione immutabile quando la validazione è superata.

Il prototipo è locale e non include backend, API di produzione, prezzi o un editor di regole generico. Il payload JSON e gli snapshot pubblicati costituiscono una rappresentazione dimostrativa per il frontend cliente.
