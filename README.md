# Moldura Duso 43123

Aplicação Flask + PostgreSQL + Volume para Railway. O visitante envia uma foto, ajusta posição/zoom no navegador, aplica a moldura e baixa o PNG final. O painel admin gerencia filtros, acompanha métricas e visualiza/remover envios.

## Railway
1. Crie um projeto no GitHub com estes arquivos.
2. No Railway, adicione **PostgreSQL**.
3. Adicione um **Volume** montado em `/data`.
4. Defina as variáveis do `.env.example`. Em `DATABASE_URL`, use a referência do serviço PostgreSQL do Railway (ex.: `${{Postgres.DATABASE_URL}}`).
5. Deploy. O app cria as tabelas e o filtro inicial automaticamente.
6. Acesse `/admin/login` com `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

## Variáveis principais
- `SECRET_KEY`: chave longa e aleatória.
- `DATA_DIR=/data`: caminho do volume persistente.
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: admin inicial.
- `RETENTION_DAYS`: retenção automática de fotos; padrão 30 dias.
- `MAX_UPLOAD_MB`: tamanho máximo de upload; padrão 15 MB.

## Privacidade
O visitante precisa aceitar explicitamente o armazenamento temporário da foto para gerar a moldura. O admin pode apagar um envio individualmente, e o sistema remove automaticamente arquivos vencidos conforme a retenção configurada.


## Entrada de produção e PostgreSQL
- O único entrypoint de produção é `wsgi.py`, iniciado como `wsgi:app`.
- O projeto usa **psycopg v3**. URLs `postgres://` e `postgresql://` são normalizadas automaticamente para `postgresql+psycopg://`, evitando dependência acidental de `psycopg2`.
- Em Railway, se `DATA_DIR` não for definido, o app assume `/data`; ainda assim, recomenda-se manter `DATA_DIR=/data` explicitamente.
- O bootstrap inicial é idempotente para evitar corrida quando mais de um worker do Gunicorn inicia ao mesmo tempo.

## Câmera com óculos Duso
- O editor oferece **Escolher foto** e **Usar câmera**.
- A câmera solicita a lente frontal (`facingMode: user`) e encaixa o PNG `app/static/img/oculos-duso.png` acompanhando os olhos e a inclinação do rosto.
- O rastreamento facial roda no navegador com MediaPipe Face Landmarker; a imagem da câmera só entra no fluxo de upload depois do clique em **Tirar foto**.
- A câmera do navegador exige contexto seguro em produção (HTTPS), o que já é atendido por um domínio HTTPS/Railway.
