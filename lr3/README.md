# ЛР3 · В10 «Служба доставки»

JavaScript · Firestore · Firebase Authentication · контейнер на Render.

Worker ЛР2: https://lab1-v10-delivery.kruxi-labs.workers.dev

Адреса Render: **ще не розгорнуто; вписати фактичну адресу після Live**.

## Параметри В10

| Налаштування | Значення |
| --- | --- |
| Локальний PORT | `8000` |
| Health Check Path | `/status` |
| Список | `/api/parcels` |
| Параметр Remote Config, вкладка Server | `list_page_size`, Number |
| Значення за замовчуванням | `25` |
| Умова | Custom signal: `browser` дорівнює `Edge` |
| Значення за умовою | `8` |

У спрощеній методичці стовпець «Образ» не використовується: взято готовий `node:24.21.0-slim` з архіву. На Render значення PORT, передане платформою, має пріоритет над config.env. Не встановлюйте там PORT=8000 вручну.

## Що перенесено

`src/`, `public/`, `check2.mjs`, `seed.mjs` і тести перенесено з ЛР2. Модель «власник і модератор», перевірка ID token, owner_uid та всі маршрути API збережені. Worker не потрібно перевикладати.

`server.mjs`, `remote-config.js`, `Dockerfile`, `rc.mjs`, `cold.mjs` взято з гілки firestore наданого архіву. У серверний адаптер додано файловий еквівалент прив'язки ASSETS для login.html/login.js саме цієї ЛР2; /login проходить через незмінний обробник ЛР2. Для /status задано no-store. Готовий модуль Remote Config не змінено.

## 1. Локальна перевірка

Усі команди нижче — PowerShell у каталозі lr3. Node.js 24 або новіший.

```powershell
npm.cmd ci
if (-not (Test-Path data)) { Copy-Item -LiteralPath ..\lr2\data -Destination data -Recurse }
Copy-Item -LiteralPath ..\lr2\.dev.vars -Destination .dev.vars
Copy-Item -LiteralPath ..\lr2\.test-users.json -Destination .test-users.json
npm.cmd run check:syntax
npm.cmd test
npm.cmd run dev:container
```

Не копіюйте файли ключа. Використовується наявний GCP_SA_KEY; спільний ADMIN_TOKEN не потрібен. `.test-users.json` потрібен для входу саме наявних alice, bob, mod. Він і .dev.vars ігноруються Git та Docker.

В іншому терміналі, також у lr3:

```powershell
curl.exe -si http://localhost:8000/status
npm.cmd run check -- http://localhost:8000
```

Має бути 24 з 24; це очікуваний критерій, а не запис про виконаний деплой. Якщо mod не має доступу, перевірте наявний документ roles/<uid mod> з role="moderator". Якщо Firestore просить індекс, відкрийте посилання з журналу сервера і дочекайтеся його готовності.

## 2. Доступ до Remote Config

У проєкті lab1-v10-delivery: Google Cloud → IAM → рядок `lr1-api@lab1-v10-delivery.iam.gserviceaccount.com` → Edit → Add another role → **Firebase Remote Config Viewer** (`roles/firebaseremoteconfig.viewer`) → Save. Наявну роль для Firestore зберегти. Новий ключ не створювати.

Ця роль дозволяє серверу читати шаблон, але не публікувати його. До надання ролі або створення серверного параметра API може працювати з параметрами ЛР2; заголовок x-rc пояснює джерело значення чи помилку.

## 3. Render

Спочатку додайте теку lr3 до репозиторію, перевіривши `git status` та список файлів у коміті. Якщо використовуєте новий репозиторій, Root Directory відповідно змінюється.

Для поточного репозиторію cloud-technologies-labs:

1. Render → New → Web Service → GitHub → репозиторій.
2. Name: наприклад `lab3-v10-delivery`; Language/Runtime: **Docker**.
3. Root Directory: `lr3`; Dockerfile Path: `./Dockerfile`; Docker Build Context: `.`.
4. Instance Type: **Free**; Health Check Path: `/status`.
5. Environment: `GCP_SA_KEY` — JSON ключа lr1-api одним значенням, без зовнішніх одинарних лапок з .dev.vars. Не додавати ключ до коду, Dockerfile чи config.env.
6. Docker Command залишити порожнім: використовується CMD образу. Дочекатися **Live**.
7. Додати фактичний домен Render до Firebase Authentication → Settings → Authorized domains, якщо Google-вхід на сторінці /login використовується з Render. Лише домен, без https:// і /login.

Публічні FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_AUTH_DOMAIN уже є в config.env. Для перевірки:

```powershell
$renderUrl = 'https://ФАКТИЧНА-НАЗВА.onrender.com'
New-Item -ItemType Directory -Force results | Out-Null
curl.exe -si "$renderUrl/status" | Tee-Object results/render-health.txt
npm.cmd run check -- $renderUrl | Tee-Object results/render-check.txt
```

Не виконуйте deploy з каталогу lr3 через Wrangler: у цій роботі розгортається лише контейнер Render.

## 4. Remote Config без розгортання

У Firebase того самого проєкту → Remote Config → **Server**, створити параметр Number `list_page_size`. Default=25; додати умову `edge-browser`: Custom signal `browser`, оператор equals, значення `Edge`. Для умови задати 8. Publish changes.

Потрібен список з понад 25 записами. Якщо seed ЛР2 ще не запускався від alice, запустіть його **один раз**; повторний запуск додає дублікати:

```powershell
$apiKey = (Get-Content -Raw wrangler.jsonc | ConvertFrom-Json).vars.FIREBASE_API_KEY
$env:ID_TOKEN = node check2.mjs $renderUrl $apiKey --token alice
node seed.mjs $renderUrl
Remove-Item Env:ID_TOKEN
node rc.mjs $renderUrl '/api/parcels?status=доставлено&city=Київ' Edge | Tee-Object results/rc-before.txt
```

У seed є 26 доставлених посилок у Києві. Власник бачить свої записи, mod — усі. У bob може бути менше 8: це не означає, що параметр не застосувався; дивіться також x-rc. Для демонстрації не передавайте limit: явний limit зберігає пріоритет.

Змініть лише значення за умовою Edge з 8 на 6, Publish; зачекайте понад 30 секунд (кеш готового модуля), без коміту, push і Deploy:

```powershell
node rc.mjs $renderUrl '/api/parcels?status=доставлено&city=Київ' Edge | Tee-Object results/rc-after.txt
```

Збережіть вивід і час останнього Deploy з Render Events. Для захисту можна повернути 6 → 8 та повторити. User-Agent — сигнал поведінки, він не надає прав на чужі записи.

## 5. Холодний і теплий запити

Закрийте вкладки Render-сервісу, припиніть перевірки та запити. Через 20 хвилин без звернень виконайте:

```powershell
node cold.mjs $renderUrl /status | Tee-Object results/cold-render.txt
node cold.mjs https://lab1-v10-delivery.kruxi-labs.workers.dev /login | Tee-Object results/cold-worker.txt
```

У Worker ЛР2 немає /status, тому для нього використовується наявний публічний /login. Це вимірювання HTTP-відповіді різних публічних маршрутів, не порівняння швидкості Firestore. cold.mjs друкує мілісекунди: для звіту поділіть на 1000. Перший запит називайте холодним лише після фактичного простою. П'ять наступних дають теплі значення і медіану.

## 6. Звіт і здача

Заповнити REPORT-LR3.html фактичними адресою, результатами check2, rc до/після, журналом PORT та своїми часами. HTML можна відкрити в браузері та надрукувати у PDF. Шаблон не заявляє, що розгортання або вимірювання вже виконані. Секрети й токени у звіт не вставляти.

У репозиторій: код lr3, Dockerfile, .dockerignore, config.env, package-lock.json, README та завершений звіт. Для приватного репозиторію архів без node_modules, data, .dev.vars, .test-users.json і ключів; data/parcels.json для seed міститься в повній робочій копії, але виключається зі здаваного архіву за вимогою завдання. Відновити тестові дані можна копіюванням з lr2/data.

Після захисту: видалити Render-сервіс; прибрати лише роль Remote Config Viewer у lr1-api (ключ Firestore зберегти до кінця курсу); тоді видалити alice, bob, mod.

## Джерела

- Надані методичка ЛР3 (спрощено), покрокова інструкція, таблиця варіантів та архів коду.
- [Render: Docker](https://render.com/docs/docker), [Free](https://render.com/docs/free).
- [Firebase: Remote Config на сервері](https://firebase.google.com/docs/remote-config/server).
