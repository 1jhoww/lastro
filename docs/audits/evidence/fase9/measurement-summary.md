# Fase 9 — resumo das medições locais

Tempos em milissegundos. Ensaios de três amostras mostram mediana e intervalo; p95 é apresentado somente nas APIs com 100 amostras por endpoint.

## Pedidos e relatórios

| Cenário | N antes/depois | Mediana antes | Mediana depois | Intervalo antes | Intervalo depois |
| --- | --- | ---: | ---: | --- | --- |
| confirm-1 | 3/3 | 305 | 332 | 208–341 | 312–357 |
| confirm-20 | 3/3 | 345 | 352 | 234–359 | 338–355 |
| confirm-50 | 3/3 | 403 | 405 | 387–431 | 347–408 |
| confirm-100 | 3/3 | 465 | 424 | 453–469 | 423–467 |
| confirm-200 | 3/3 | 745 | 619 | 676–757 | 615–668 |
| replay-200 | 3/3 | 178 | 174 | 144–179 | 140–178 |
| dispatch-200 | 3/3 | 524 | 499 | 478–546 | 488–572 |
| list-500 | 5/5 | 1582 | 1615 | 1531–1605 | 1454–1631 |
| filter-500 | 5/5 | 1597 | 1594 | 1565–1641 | 1533–1606 |
| report-500 | 5/5 | 655 | 645 | 619–691 | 636–675 |

## APIs: 100 amostras por endpoint e versão

| Endpoint | Mediana antes/depois | p95 antes/depois | Erros antes/depois |
| --- | --- | --- | --- |
| /tenants/current | 78/78 | 80/80 | 0/0 |
| /customers?limit=50 | 93/93 | 95/96 | 0/0 |
| /customers?limit=50&q=mer | 93/93 | 95/96 | 0/0 |
| /products?limit=50 | 92/92 | 96/95 | 0/0 |
| /products?limit=50&q=ar | 93/93 | 95/95 | 0/0 |
| /orders?limit=50 | 452/452 | 487/483 | 0/0 |
| /orders?limit=50&status=confirmed | 156/157 | 174/174 | 0/0 |
| /inventory?limit=50 | 122/114 | 127/127 | 0/0 |
| /inventory/replenishment?limit=50 | 95/108 | 111/111 | 0/0 |
| /receivables?limit=50 | 970/718 | 1065/755 | 0/0 |
| /payments?limit=50 | 93/95 | 110/111 | 0/0 |
| /visits?limit=50 | 108/107 | 111/111 | 0/0 |
| /reports/orders-status | 120/120 | 127/127 | 0/0 |
| /reports/sales-period | 111/113 | 127/126 | 0/0 |

## Navegador

| Perfil/métrica | Mediana antes/depois | Intervalo antes | Intervalo depois |
| --- | --- | --- | --- |
| desktop: readyMs | 302/344 | 295–404 | 339–417 |
| desktop: lcp | 312/332 | 304–416 | 316–392 |
| desktop: loginDashboardMs | 1381/735 | 1368–1422 | 657–780 |
| desktop: customerPageMs | 288/279 | 276–295 | 275–288 |
| desktop: customerFilterMs | 425/427 | 409–426 | 424–428 |
| mobile: readyMs | 8912/7988 | 8904–8948 | 7900–8013 |
| mobile: lcp | 8836/7872 | 8808–8848 | 7772–7920 |
| mobile: loginDashboardMs | 1887/1697 | 1809–1942 | 1572–1697 |
| mobile: customerPageMs | 8551/7482 | 8511–8579 | 7437–7485 |
| mobile: customerFilterMs | 625/663 | 586–630 | 658–673 |

Fontes, tamanhos, respostas do Dashboard, RSS amostrado e arquivos de relatório estão no [resumo JSON](measurement-summary.json). Heap de `performance.memory` é apenas observação de navegador, sem isolamento suficiente para afirmar ganho de memória.
