import React from '/@id/react';
import ReactDOMClient from '/@id/react-dom/client';

function renderComponent(Component, props) {
  const container = props?.container ?? document.getElementById('root');
  if (!container) return;

  const mergedProps = props ?? { container, config: {}, data: {}, events: {} };
  const createRoot = ReactDOMClient.createRoot;
  createRoot(container).render(React.createElement(Component, mergedProps));
}

const ReactDOM = { createRoot: ReactDOMClient.createRoot };

if (typeof window !== 'undefined') {
  window.DevTemplateBootstrap = { renderComponent, React, ReactDOM };
}
