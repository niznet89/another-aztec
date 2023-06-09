import React, { useEffect, useState } from 'react';
import { default as styled, keyframes } from 'styled-components';
import { Terminal } from './terminal.js';

const glitch = keyframes`
  30%  { }
  95%  { opacity: 1; left: 0; -webkit-transform: scale(1,1);  -webkit-transform: skew(0,0); }
  96%  { opacity: 0.8; left: -100px; -webkit-transform: scale(1,1.2);  -webkit-transform: skew(50deg,0); }
  97%  { opacity: 0.8; left: 100px; -webkit-transform: scale(1,1.2);  -webkit-transform: skew(-80deg,0); }
  98%  { opacity: 1; left: 0; -webkit-transform: scale(0,0);  -webkit-transform: skew(0,0); }
  100% { opacity: 0; }
`;

const flicker = keyframes`
  0%   { opacity: 0.9;}
  50%  { opacity: 1; }
  100% { opacity: 0.9; }
`;

const StyledTerminalSelectionText = styled.div`
  position: absolute;
  top: 0px;
  width: 100%;
  margin: 50px auto;
  text-align: center;

  padding-top: 30px;

  font-family: 'Courier new';
  color: rgba(255, 255, 255, 0);
  font-size: 50px;
  font-weight: bold;
  font-style: normal;
  white-space: pre;
  text-align: center;
`;

const Monitor = styled.div`
  position: absolute;
  top: 0px;
  width: 100%;
  margin: 50px auto;
  text-align: center;
  animation: ${flicker} 32ms infinite;
`;

const Display = styled.div`
  user-select: none;
  display: inline-block;
  position: relative;
  background-color: #000;
  overflow: hidden;
  padding: 30px;
`;

const Logo = styled.div`
  position: absolute;
  margin: auto auto;
  fill: rgba(255, 255, 255, 0.8);
  filter: blur(3px);
  width: 400px;
  left: 0;
  right: 0;
  animation: ${glitch} 2s 1;
  animation-fill-mode: forwards;
`;

const StyledTerminal = styled.div`
  font-family: 'Courier new';
  color: rgba(255, 255, 255, 0.8);
  font-size: 50px;
  font-weight: bold;
  font-style: normal;
  white-space: pre;
  filter: blur(1px);
  text-align: center;
  text-shadow: 0 0 30px rgba(255, 255, 255, 0.4);
`;

const Scanline = styled.div`
  width: 100%;
  display: block;
  background: #000;
  height: 3px;
  position: relative;
  z-index: 3;
  margin-bottom: 4px;
  opacity: 0.1;
`;

const ScanlineContainer = styled.div`
  position: absolute;
  top: 0px;
  width: 100%;
  padding-top: 30px;
`;

interface TerminalProps {
  terminal: Terminal;
}

export function TerminalPage({ terminal }: TerminalProps) {
  const [, setCount] = useState(0);
  useEffect(() => {
    const eventListener = (e: KeyboardEvent) => {
      terminal.keyDown(e);
    };
    terminal.on('updated', setCount);
    window.addEventListener('keydown', eventListener);
    return () => {
      terminal.removeListener('updates', setCount);
      window.removeEventListener('keydown', eventListener);
    };
  }, [terminal]);

  return (
    <>
      <Monitor>
        <Display onPaste={e => terminal.pasteString(e.clipboardData.getData('text'))}>
          <Logo>
            <svg viewBox="500 80 135 138">
              <g>
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M 573.12 83.536 L 632.518 142.933 C 635.642 146.057 635.642 151.123 632.518 154.247 L 573.12 213.643 C 569.996 216.768 564.931 216.768 561.807 213.643 L 502.41 154.247 C 499.286 151.123 499.286 146.057 502.41 142.933 L 561.807 83.536 C 564.931 80.412 569.996 80.412 573.12 83.536 Z M 573.12 104.749 C 569.996 101.625 564.931 101.625 561.807 104.749 L 523.623 142.933 C 520.499 146.057 520.499 151.123 523.623 154.247 L 561.807 192.43 C 564.931 195.554 569.996 195.554 573.12 192.43 L 611.304 154.247 C 614.428 151.123 614.428 146.057 611.304 142.933 L 573.12 104.749 Z"
                ></path>
                <path
                  opacity="1"
                  d="M 590.091 142.933 L 573.12 125.963 C 569.996 122.838 564.931 122.838 561.807 125.963 L 544.836 142.933 C 541.712 146.057 541.712 151.123 544.836 154.247 L 561.807 171.217 C 564.931 174.342 569.996 174.342 573.12 171.217 L 590.091 154.247 C 593.215 151.123 593.215 146.057 590.091 142.933 Z"
                ></path>
              </g>
            </svg>
          </Logo>
          <StyledTerminal>{terminal.asString()}</StyledTerminal>
          <ScanlineContainer>
            {Array(9 * terminal.getRows())
              .fill(0)
              .map((_, i) => (
                <Scanline key={i}></Scanline>
              ))}
          </ScanlineContainer>
        </Display>
      </Monitor>
      <StyledTerminalSelectionText onPaste={e => terminal.pasteString(e.clipboardData.getData('text'))}>
        {terminal.asString(false).toLowerCase()}
      </StyledTerminalSelectionText>
    </>
  );
}
