# Visão de produto — Atlas

## A ideia central

O Atlas deve ser um espaço local para **escrever, conectar e organizar visualmente** — um mesmo projeto pode começar como documento, virar mapa mental e continuar reunindo imagens, tabelas e referências sem trocar de aplicativo.

A decisão de interface que permanece fixa nesta linha é o **explorador de arquivos à direita**. O espaço central é o conteúdo; a barra superior contém navegação e ações globais; as ferramentas contextuais aparecem próximas do objeto que está sendo editado.

## O que vale aproveitar das referências

| Referência | Padrão útil para o Atlas | Como se traduz no projeto |
| --- | --- | --- |
| Obsidian | Arquivos locais, notas interligadas e canvas espacial | Dados locais, mapas com cartões e conexões; futura exportação aberta para Markdown/JSON Canvas |
| Notion | Blocos de conteúdo, páginas e organização por contexto | Documentos ricos, tabelas, listas, pastas e abas de documentos |
| Milanote | Quadro livre para pensar visualmente | Cartões móveis e redimensionáveis, imagens, grupos e conexões sem impor um fluxo linear |
| Google Docs | Edição previsível e ferramentas de documento | Editor rico, atalhos, tabelas, impressão, ajuste de página e imagens no fluxo de texto |

Nenhum dos produtos é usado como molde literal. O Atlas deve combinar os padrões úteis sem copiar a complexidade de cada aplicativo.

## Bibliotecas escolhidas

- **React + TypeScript:** interface modular e contratos de dados explícitos.
- **Tauri 2 + Rust:** aplicativo desktop leve em relação a empacotar um navegador completo; armazenamento de workspace local.
- **React Flow (`@xyflow/react`):** canvas com pan, zoom, nós personalizados, seleção, conexões e redimensionamento. A folha de estilos oficial deve ser importada para o canvas funcionar corretamente.
- **Tiptap + ProseMirror:** editor de documentos e cartões. Node Views permitem controles personalizados de imagem sem separar a imagem do modelo editável do documento.
- **Radix UI:** menus e diálogos com comportamento de teclado/foco já resolvido.
- **Lucide:** ícones consistentes, com pouco ruído visual.
- **IndexedDB no teste via navegador e arquivos locais no desktop:** mais adequado para workspaces com imagens do que guardar o projeto inteiro em `localStorage`.

Fontes de referência oficiais:

- Obsidian Canvas: https://obsidian.md/pt-BR/help/plugins/canvas
- React Flow: https://reactflow.dev/ e https://reactflow.dev/examples
- Tiptap Node Views: https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views
- Tiptap imagens: https://tiptap.dev/docs/editor/extensions/nodes/image
- Tauri 2: https://v2.tauri.app/

## Regras de interação

1. **Não esconder a affordance:** os cartões têm borda sutil persistente; seleção e hover aumentam o contraste. Os puxadores aparecem no hover/foco e têm área de clique maior que seu desenho visual.
2. **Editar e mover são ações diferentes:** o cabeçalho movimenta o cartão; a área de texto continua selecionável e editável.
3. **A imagem pertence ao texto:** a imagem inserida no cartão faz parte do documento do Tiptap, não de uma segunda camada de anotação independente.
4. **Mover não deve exigir um preset:** durante o arraste a imagem acompanha o ponteiro livremente e o texto abre espaço com uma transição curta; ao soltar, a imagem é ancorada no trecho de texto mais próximo e usa o fluxo nativo do navegador para contornar o quadro e voltar à largura total abaixo. O lado é inferido pela posição do soltar, sem botões de alinhamento. Só usa coordenadas absolutas se não houver um ponto de texto válido.
5. **Modificadores explícitos:** `Ctrl` + arrastar uma borda redimensiona/estica; `Alt` + arrastar uma borda recorta. O movimento normal não deve saltar para outro parágrafo ao soltar.
6. **Ações previsíveis e reversíveis:** excluir, duplicar, mover pasta, importar e exportar devem ser ações distintas, com menus de contexto próximos do objeto.
7. **Local-first:** abrir, escrever e consultar arquivos não deve depender de conta, login ou internet após a instalação. A rede é necessária apenas para instalar dependências ou atualizar a aplicação.

## Base funcional herdada da Alpha 1.4

- Canvas livre com cartões de texto, imagens independentes, tabelas, grupos, documentos conectados e linhas entre objetos.
- Documento rico com formatação, listas, tabelas, imagens, atalhos, impressão e abas.
- Explorador à direita, pastas, pesquisa, renomeação, duplicação, movimento de arquivos, temas e backup JSON.
- Inserção de imagem diretamente no cabeçalho de cada cartão e também por menu de inserção.
- Prévia de arraste livre; ao soltar, ancoragem automática no texto mais próximo e contorno nativo do texto, com fallback de posição livre quando necessário.
- `Ctrl` + borda para redimensionar e `Alt` + borda para recortar.
- Salvamento automático, estado visível de salvamento e suporte local no modo desktop.

## Direção visual anterior — Atlas 1.5 Alpha

A interface foi renovada a partir de quatro influências complementares enviadas pelo usuário, sem copiar um produto específico:

- **Canvas primeiro:** o mapa mental domina a área central, com pontos discretos, nós móveis e conexões legíveis.
- **Ferramentas à mão:** ações gerais no topo, formatação numa segunda faixa e criação de objetos num trilho vertical à esquerda.
- **Organização lateral:** o explorador de arquivos continua à direita, com pastas, documentos, mapas e imagens agrupados.
- **Cartões em primeiro plano:** raio de borda mais generoso, sombra suave, hierarquia tipográfica e estado de seleção bem definido.
- **Tema claro como padrão naquela versão:** paleta neutra com acento verde-água; tema escuro equivalente disponível.
- **Movimento sutil:** transições curtas em foco, hover e menus, respeitando a configuração do sistema para reduzir movimento.
- **Sem painel fixo de propriedades:** instruções e atalhos continuam em Ajuda e atalhos.

Os estilos do redesign ficam isolados em `src/styles-redesign.css` para permitir iterar a identidade visual sem substituir os componentes e comportamentos da base.

## Próximos passos recomendados (não prometer como já implementados)

### Prioridade alta

- Validar os gestos em uma execução real de Windows/WebView2; cobrir bordas, cantos, imagens transparentes, zoom do canvas e cartões pequenos.
- Importar/exportar documentos Markdown e canvas no formato aberto JSON Canvas, mantendo recursos anexos como arquivos separados.
- Backlinks e links internos entre documentos, com uma lista de referências de entrada.
- Histórico de versões e recuperação de versões anteriores.

### Prioridade média

- Paleta de comandos pesquisável e configurável.
- Navegação por títulos/outline de documento e propriedades simples (tags, status, projeto).
- Alinhar/distribuir objetos no canvas, encaixe opcional à grade, minimapa e atalhos de navegação.
- Modelos para notas de reunião, pesquisa, briefing, ficha de personagem e planejamento.

### Só depois de medir necessidade

- Colaboração em tempo real, sincronização na nuvem, plugins e banco de dados externo. Esses recursos aumentariam o custo e a superfície de falhas; não são necessários para o objetivo local-first inicial.


## Direção Modular Lore Workspace — 1.6 Alpha

A interface combina canvas espacial, cartões com etiquetas/pílulas semânticas e uma ficha contextual deslizante. O tema escuro usa carvão profundo (#121214), superfícies #1c1d22 e acento teal luminoso, com pílulas pastel distintas para status, prioridade e raridade. A ficha lateral permite classificar objetos e adicionar descrição sem substituir a edição de texto rico no canvas. O clique explícito no ícone de ficha evita abrir o painel durante arraste, redimensionamento ou seleção de texto.


## Direção visual atual — Atlas 1.6 Alpha / Modular Lore Workspace

- **Dark-first charcoal:** fundo profundo `#121214`, superfícies `#1c1d22` e acento teal luminoso; tema claro permanece disponível.
- **Cartões de lore:** pílulas de status, prioridade, raridade, nível e tags com cores semânticas suaves.
- **Ficha contextual:** o botão de livro na barra do cartão abre uma ficha lateral com dados, descrição e prévia, mantendo o canvas visível. O mesmo acesso existe para imagem, tabela, grupo e documento.
- **Conteúdo sem conflito:** a ficha edita metadados e descrição curta; o texto rico continua editável dentro do próprio cartão/documento.
- **Não reescrever dados antigos:** a chave persistente do workspace permanece a mesma; a preferência de tema usa uma chave nova para estabelecer o tema escuro inicial.
