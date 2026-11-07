# Super Scrcpy 🚀

![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white)
![C](https://img.shields.io/badge/C-00599C?style=for-the-badge&logo=c&logoColor=white)
![SDL3](https://img.shields.io/badge/SDL3-1F6FEB?style=for-the-badge&logo=SDL&logoColor=white)
![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

> **Super Scrcpy** é um fork customizado e turbinado do aclamado [scrcpy](https://github.com/Genymobile/scrcpy), reescrito com uma **GUI moderna em Electron** e recursos nativos de produtividade — **Picture-in-Picture**, **Click-Through**, **Lock de tela**, **System Tray** e **multi-device** — mantendo o núcleo de vídeo em **C + SDL3** para latência ultrabaixa.

---

## 📸 Visão Geral

O Super Scrcpy pega toda a potência do scrcpy original (espelhamento de tela Android via ADB com baixíssima latência) e adiciona uma camada de conforto que faltava: uma interface gráfica limpa, janela flutuante sempre visível, atalhos globais e suporte a vários dispositivos simultâneos. Ideal para quem usa o celular como segunda tela, para desenvolvimento, testes ou simplesmente para não perder uma notificação.

---

## ⌨️ Atalhos de Teclado

> **`MOD`** é o modificador padrão do scrcpy. Por padrão é **`Alt` (esquerdo)**, mas você pode trocar para **`Super` (tecla Windows)** nas configurações — o que evita conflitos com atalhos do sistema e de outros apps.

### 🎯 Atalhos Customizados (Super Scrcpy)

| Atalho | Ação |
|---|---|
| `MOD` + `U` | Alterna **Click-Through** (o mouse atravessa a janela do celular e interage com o que está atrás) |
| `MOD` + `L` | **Lock / Unlock** da tela do dispositivo (bloqueia toques acidentais sem desligar o espelhamento) |
| `MOD` + `A` | Alterna janela **Always-on-Top** (fixa sobre as demais) |
| `MOD` + `Shift` + `P` | Entra / sai do modo **Picture-in-Picture (PiP)** nativo |
| `MOD` + `1` … `MOD` + `9` | Alterna entre **dispositivos conectados** (multi-device) |
| `MOD` + `T` | Mostra / oculta a **System Tray** |
| `MOD` + `Shift` + `T` | Envia a janela ativa para a bandeja |

### 🔧 Atalhos Herdados do scrcpy

| Atalho | Ação |
|---|---|
| `MOD` + `H` | Home |
| `MOD` + `B` | Voltar |
| `MOD` + `S` | App switcher (recentes) |
| `MOD` + `P` | Power (liga/desliga tela) |
| `MOD` + `M` | Menu |
| `MOD` + `O` | Desliga a tela do dispositivo (mantendo espelhamento) |
| `MOD` + `Shift` + `O` | Liga a tela do dispositivo |
| `MOD` + `F` | Alterna tela cheia |
| `MOD` + `R` | Rotaciona a tela |
| `MOD` + `↑` / `↓` | Aumenta / diminui volume |
| `MOD` + `C` | Copia para o clipboard do dispositivo |
| `MOD` + `V` | Cola do clipboard do computador |
| `MOD` + `Shift` + `C` | Copia do dispositivo para o PC |
| `MOD` + `Shift` + `V` | Cola do PC para o dispositivo |
| `MOD` + `G` | Redimensiona a janela (1:1, arraste o mouse) |
| `MOD` + `Shift` + `G` | Ajusta a janela ao tamanho da tela |
| `MOD` + `I` | Mostra FPS |
| `MOD` + `N` | Abre o painel de notificações |
| `MOD` + `Shift` + `N` | Fecha o painel de notificações |
| `MOD` + `Z` | Pausa o espelhamento |
| `MOD` + `Shift` + `Z` | Retoma o espelhamento |
| `MOD` + `W` | Ativa modo wireless (sem cabo) |

> 💡 **Dica:** Você pode remapear qualquer atalho em **Configurações → Atalhos**. O `MOD` também é configurável (`Alt`, `Super` ou `Ctrl`).

---

## ✨ Funcionalidades

- 🖼️ **Picture-in-Picture (PiP) nativo** — transforme o celular em uma mini-janela flutuante sempre visível, sem bordas e sem roubar foco.
- 🔒 **Modo Lock** — trave a tela do dispositivo com um atalho. Perfeito para exibir dashboards, receitas ou vídeos sem toques acidentais.
- 🖱️ **Click-Through** — o cursor atravessa a janela do celular e clica no que está atrás. Ideal para usar o Android como overlay decorativo.
- 📌 **Always-on-Top** — fixe a janela do celular sobre qualquer outro app.
- 📥 **System Tray** — minimize para a bandeja sem fechar a conexão; ícone reativo com status do dispositivo.
- 📱 **Multi-Device** — conecte vários Androids via ADB ao mesmo tempo e alterne entre eles com `MOD + 1…9`.
- 🎨 **GUI moderna em Electron** — configurações, gerenciamento de dispositivos, logs e temas em uma interface limpa e responsiva.
- ⚡ **Núcleo em C + SDL3** — a mesma latência ultrabaixa do scrcpy original, agora com controles amigáveis.
- 🎧 **Áudio e vídeo** — repasse de áudio do dispositivo (Android 11+) e vídeo acelerado por hardware.
- 🪟 **Suporte a Windows** — `.exe` autocontido, sem necessidade de instalar dependências manualmente.

---

## 📦 Instalação

### Método recomendado — Baixar o `.exe`

1. Acesse a aba **[Releases](https://github.com/piedadedod-dotcom/super-scrcpy/releases/tag/v1.0.0)** do projeto.
2. Baixe o arquivo **`SuperScrcpy-Setup-v1.0.0.exe`** (instalador) ou **`SuperScrcpy-v1.0.0-portable.exe`** (portátil, sem instalação).
3. Execute o arquivo, aceite o UAC se solicitado e siga o assistente de instalação.
4. Pronto! O ícone do **Super Scrcpy** aparecerá na sua área de trabalho e na bandeja do sistema.

### Pré-requisitos

- **Windows 10 ou 11** (64-bit).
- **ADB** disponível no `PATH` (o instalador já inclui uma versão e a configura automaticamente na primeira execução).
- **Depuração USB ativada** no dispositivo Android (Configurações → Opções do Desenvolvedor → Depuração USB).
- Para modo **wireless**, ambos os dispositivos devem estar na **mesma rede Wi-Fi**.

### Primeira Conexão

1. Conecte o Android via cabo USB e autorize a depuração quando solicitado.
2. Abra o **Super Scrcpy** e clique em **"Adicionar Dispositivo"**.
3. O app listará o dispositivo detectado — clique em **Conectar**.
4. Use os atalhos `MOD + U`, `MOD + A` ou `MOD + Shift + P` para explorar os modos especiais.

---

## 🤝 Créditos & Licença

Este projeto é um **fork não oficial** do [**Genymobile/scrcpy**](https://github.com/Genymobile/scrcpy), criado e mantido pela Genymobile.

O Super Scrcpy é distribuído sob a **Licença Apache 2.0**, a mesma do projeto original. Toda a base de captura, espelhamento e protocolo ADB é de autoria do time do scrcpy — nosso trabalho consiste exclusivamente em uma camada de **GUI, atalhos e recursos de produtividade** em cima dessa fundação fantástica.

- 🔗 **Projeto original:** https://github.com/Genymobile/scrcpy
- 📜 **Licença Apache 2.0:** https://www.apache.org/licenses/LICENSE-2.0
- ❤️ **Agradecimentos** a [@rom1v](https://github.com/rom1v) e a toda a comunidade scrcpy.

---

## 📄 Licença

Copyright 2024-2026 Super Scrcpy contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

text

---

<p align="center">
  Feito com ☕, C e Electron. Contribuições são bem-vindas!<br/>
  <a href="https://github.com/piedadedod-dotcom/super-scrcpy">⭐ Deixe uma estrela no repositório</a>
</p>