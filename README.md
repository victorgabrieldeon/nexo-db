# Nexo DB

Cliente PostgreSQL desktop (Electron + React), na linha do DBeaver, mas focado em Postgres e com uma interface mais leve.

## Rodando

```bash
npm install
npm run dev        # desenvolvimento com hot reload
npm run build      # build de produção em out/
npm run typecheck
```

`NEXO_USER_DATA=/algum/dir npm run dev` isola conexões e histórico em outro diretório.

## O que já tem

- **Conexões**: cadastro com cor, teste, SSL, senha cifrada pelo chaveiro do SO (`safeStorage`). Dá para colar uma URL `postgres://` no formulário.
- **Explorador**: conexão → bancos → schemas → tabelas, views, views materializadas, funções e sequências, com colunas expansíveis e filtro.
- **Editor SQL** (CodeMirror 6):
  - autocomplete por contexto: tabelas depois de `FROM`/`JOIN`, colunas das tabelas do comando atual, `alias.coluna`, `schema.tabela`, funções do banco e nativas
  - `Ctrl+Enter` executa o comando sob o cursor (ou a seleção), `Ctrl+Shift+Enter` executa o script inteiro, `Ctrl+Shift+E` faz EXPLAIN
  - o erro aparece sublinhado na posição exata, com a dica do Postgres
- **Sessão por aba**: cada aba de consulta tem a própria conexão, então `BEGIN`/`SET`/tabelas temporárias funcionam. Quando há transação aberta aparecem botões de Commit e Rollback. Dá para cancelar a consulta em execução.
- **Resultados**: grid virtualizado, com cursor e limite configurável (padrão 1000 linhas), ordenação, redimensionamento de colunas, seleção por faixa e cópia como TSV, JSON ou INSERT. Exporta CSV, JSON ou SQL.
- **Tabelas**: dados paginados com filtro `WHERE`. Edição inline, inclusão e exclusão de linhas em tabelas com PK, aplicadas numa transação. Também mostra estrutura (colunas, constraints, índices) e DDL.
- **Colunas**: mostrar/ocultar e reordenar arrastando (pelo cabeçalho ou pelo seletor), lembrado por tabela.
- **Navegação por FK**: seta ↴ numa FK mostra o registro referenciado num painel abaixo; seta ↲ no `id` lista as tabelas que apontam para o registro (com busca, ordenação e contagem). Ctrl+clique abre a tabela filtrada. Funciona também em resultados de consultas com JOIN.
- **Paleta de comandos** (`Ctrl+K`) para abrir tabelas e conexões, e histórico de consultas pesquisável.

## Arquitetura

```
src/main      processo principal: pools pg, sessões por aba, metadados, persistência (userData/*.json)
src/preload   ponte IPC tipada (window.api)
src/renderer  React + Tailwind v4 + zustand + motion
src/shared    tipos compartilhados
```

Os valores chegam do Postgres como texto cru (sem parse em JS), o que preserva `numeric`, `bigint` e o formato de datas.
