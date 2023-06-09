import React from 'react';
import { createGlobalStyle } from 'styled-components';
import { Terminal } from './terminal.js';
import { TerminalPage } from './terminal_page.js';

const GlobalStyle = createGlobalStyle`
  body {
    background-color: black;
  }
`;

export function TerminalComponent({ terminal }: { terminal: Terminal }) {
  return (
    <React.Fragment>
      <GlobalStyle />
      <TerminalPage terminal={terminal} />
    </React.Fragment>
  );
}
