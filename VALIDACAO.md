# Validação Atlas 1.7.5 Alpha

Verificações incluídas no pacote:
- Testes estáticos de estado das conexões, path angular e reconexão.
- Testes estáticos para alças de imagem hover-only e empilhamento acima da viewport da imagem.
- Testes estáticos para os menus de alinhamento/listas não bloquearem o evento de seleção.
- JSON de `package.json` e `tauri.conf.json` parseável.

Não declarar build visual/desktop como validado sem executar `npm run build` e testar no navegador.
