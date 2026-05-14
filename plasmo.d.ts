declare module '*.css';

declare module 'url:*' {
  const value: string;
  export default value;
}

declare module 'raw:*' {
  const value: string;
  export default value;
}

declare module 'data-text:*' {
  const value: string;
  export default value;
}
