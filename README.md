# CRM de Vendas

Um quadro kanban simples para acompanhar negócios (leads, propostas, negociações) por estágio, com dashboard de métricas e persistência local no navegador.

## Funcionalidades

- Quadro kanban com arrastar-e-soltar entre estágios: Lead, Contato Feito, Proposta, Negociação, Ganho, Perdido.
- Cadastro, edição e exclusão de negócios (cliente, contato, valor estimado, notas).
- Dashboard com negócios abertos, valor em pipeline, ganhos do mês e taxa de conversão.
- Dados salvos automaticamente no `localStorage` do navegador — não requer backend.

## Como usar

Basta abrir o arquivo `index.html` em um navegador. Não há dependências ou passos de build.

## Estrutura

- `index.html` — marcação da página e do modal de cadastro/edição.
- `style.css` — estilos do quadro, cartões e modal.
- `script.js` — lógica de estado, renderização do quadro e persistência.
