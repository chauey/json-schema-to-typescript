import { whiteBright } from 'cli-color';
import { omit } from 'lodash';
import { DEFAULT_OPTIONS, Options } from './index';
import { AST, ASTWithStandaloneName, TArray, TEnum, TInterface, TIntersection, TNamedInterface, TUnion, hasComment, hasStandaloneName } from './types/AST';
import { log, toSafeString } from './utils';

const APP_PREFIX = 'Oas';

export function generate(ast: AST, options = DEFAULT_OPTIONS): string {
  return [
    options.bannerComment +
    `
import { ${APP_PREFIX}ExtensibleNode, I${APP_PREFIX}NodeVisitor } from 'oai-ts-core';`, // HACK: // TODO: CKN
    declareNamedTypes(ast, options),
    declareNamedInterfaces(ast, options, ast.standaloneName!),
    declareEnums(ast, options)
  ]
    .filter(Boolean)
    .join('\n\n')
    + '\n' // trailing newline
}

function declareEnums(
  ast: AST,
  options: Options,
  processed = new Set<AST>()
): string {

  if (processed.has(ast)) {
    return ''
  }

  processed.add(ast)
  let type = ''

  switch (ast.type) {
    case 'ENUM':
      type = generateStandaloneEnum(ast, options) + '\n'
      break
    case 'ARRAY':
      return declareEnums(ast.params, options, processed)
    case 'TUPLE':
      return ast.params.reduce((prev, ast) => prev + declareEnums(ast, options, processed), '')
    case 'INTERFACE':
      type = getSuperTypesAndParams(ast).reduce((prev, ast) =>
        prev + declareEnums(ast, options, processed),
        '')
      break
    default:
      return ''
  }

  return type
}

function declareNamedInterfaces(
  ast: AST,
  options: Options,
  rootASTName: string,
  processed = new Set<AST>()
): string {

  if (processed.has(ast)) {
    return ''
  }

  processed.add(ast)
  let type = ''

  switch (ast.type) {
    case 'ARRAY':
      type = declareNamedInterfaces((ast as TArray).params, options, rootASTName, processed)
      break
    case 'INTERFACE':
      type = [
        hasStandaloneName(ast) && (ast.standaloneName === rootASTName || options.declareExternallyReferenced) && generateStandaloneInterface(ast, options),
        hasStandaloneName(ast) && (ast.standaloneName === rootASTName || options.declareExternallyReferenced) && generateStandaloneClass(ast, options),
        getSuperTypesAndParams(ast).map(ast =>
          declareNamedInterfaces(ast, options, rootASTName, processed)
        ).filter(Boolean).join('\n')
      ].filter(Boolean).join('\n')
      break
    case 'INTERSECTION':
    case 'UNION':
      type = ast.params.map(_ => declareNamedInterfaces(_, options, rootASTName, processed)).filter(Boolean).join('\n')
      break
    default:
      type = ''
  }

  return type
}

function declareNamedTypes(
  ast: AST,
  options: Options,
  processed = new Set<AST>()
): string {

  if (processed.has(ast)) {
    return ''
  }

  processed.add(ast)
  let type = ''

  switch (ast.type) {
    case 'ARRAY':
      type = [
        declareNamedTypes(ast.params, options, processed),
        hasStandaloneName(ast) ? generateStandaloneType(ast, options) : undefined
      ].filter(Boolean).join('\n')
      break
    case 'ENUM':
      type = ''
      break
    case 'INTERFACE':
      type = getSuperTypesAndParams(ast).map(ast => declareNamedTypes(ast, options, processed)).filter(Boolean).join('\n')
      break
    case 'INTERSECTION':
    case 'UNION':
      type = [
        hasStandaloneName(ast) ? generateStandaloneType(ast, options) : undefined,
        ast.params.map(ast => declareNamedTypes(ast, options, processed)).filter(Boolean).join('\n')
      ].filter(Boolean).join('\n')
      break
    default:
      if (hasStandaloneName(ast)) {
        type = generateStandaloneType(ast, options)
      }
  }

  return type
}

function generateType(ast: AST, options: Options): string {
  log(whiteBright.bgMagenta('generator'), ast)

  if (hasStandaloneName(ast)) {
    return toSafeString(APP_PREFIX + ast.standaloneName)
  }

  switch (ast.type) {
    case 'ANY': return 'any'
    case 'ARRAY': return (() => {
      let type = generateType(ast.params, options)
      return type.endsWith('"') ? '(' + type + ')[]' : type + '[]'
    })()
    case 'BOOLEAN': return 'boolean'
    case 'INTERFACE': return generateInterface(ast, options)
    case 'INTERSECTION': return generateSetOperation(ast, options)
    case 'LITERAL': return JSON.stringify(ast.params)
    case 'NUMBER': return 'number'
    case 'NULL': return 'null'
    case 'OBJECT': return 'object'
    case 'REFERENCE': return ast.params
    case 'STRING': return 'string'
    case 'TUPLE': return '['
      + ast.params.map(_ => generateType(_, options)).join(', ')
      + ']'
    case 'UNION': return generateSetOperation(ast, options)
  }
}

/**
 * Generate a Union or Intersection
 */
function generateSetOperation(ast: TIntersection | TUnion, options: Options): string {
  const members = (ast as TUnion).params.map(_ => generateType(_, options))
  const separator = ast.type === 'UNION' ? '|' : '&'
  return members.length === 1 ? members[0] : '(' + members.join(' ' + separator + ' ') + ')'
}

function generateInterface(
  ast: TInterface,
  options: Options
): string {
  return `{`
    + '\n'
    + ast.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(({ isRequired, keyName, ast }) => [isRequired, keyName, ast, generateType(ast, options)] as [boolean, string, AST, string])
      .map(([isRequired, keyName, ast, type]) =>
        (hasComment(ast) && !ast.standaloneName ? generateComment(ast.comment) + '\n' : '')
        + '  ' + escapeKeyName(keyName)
        + (isRequired ? '' : '?')
        + ': '
        + (hasStandaloneName(ast) ? toSafeString(type) : type) + ';'
      )
      .join('\n')
    + '\n'
    + '}'
}

function generateClass(
  ast: TInterface,
  options: Options
): string {
  return `{`
    + '\n'
    // 1. name property
    + (ast.keyName === '[k: string]' || ast.keyName === '^\\/' ? '  _name: string;\n' : '')

    // 2. properties
    + ast.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(({ isRequired, keyName, ast }) => [isRequired, keyName, ast, generateType(ast, options)] as [boolean, string, AST, string])
      .map(([isRequired, keyName, ast, type]) =>
        (hasComment(ast) && !ast.standaloneName ? generateComment(ast.comment) + '\n' : '')
        + '  ' + escapeKeyName(keyName)
        + (isRequired ? '' : '?')
        + ': '
        + (hasStandaloneName(ast) ? toSafeString(type) : type) + ';'
      )
      .join('\n')
    + '\n'

    // 3. constructor - if has required field?
    // name constructor
    + (ast.keyName === '[k: string]' || ast.keyName === '^\\/' || ast.keyName === '[1-5](?:\\d{2}|XX)' ?
      `
  constructor(name: string) {
    super();
    this._name = name;
  }`
      : '')

    // 4. create child object
    + ast.params
      // HACK: To also let us isPatternProperty - .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .filter(_ => !_.isUnreachableDefinition)
      .map(({ keyName, ast, isPatternProperty }) => [keyName, ast,
        generateType(ast, options), isPatternProperty] as [string, AST, string, boolean])
      .map(([keyName, ast, type, isPatternProperty]) => {

        if (ast.type === 'INTERFACE') {
          let namedNodeVarName = 'name';
          let standAloneName = hasStandaloneName(ast) ? ast.standaloneName
            : generateStandaloneType(<ASTWithStandaloneName>ast, options);

          // Named Node Child Property 
          // Components -> response, security-schema, callback, encoding, example, header, link-parameter
          //    link, media-type, request-body, server-variable
          // Operation -> callbacks
          if (ast.params[0].keyName === '[k: string]') {
            keyName = hasStandaloneName(ast.params[0].ast) ? <string>ast.params[0].ast.standaloneName : '??1';
            standAloneName = hasStandaloneName(ast.params[0].ast) ? <string>ast.params[0].ast.standaloneName : '??2';
            type = generateType(ast.params[0].ast, options);

            // UNION: (Operation -> callbacks) standaloneName and type needs work
            // if(ast.params[0].ast.type === 'UNION') {
            //   standAloneName = (<any>ast.params[0].ast).params[0].standaloneName;
            //   type = `${APP_PREFIX}${standAloneName}`;
            // }
            return generateCreateNamedNode(keyName, standAloneName, type
              , namedNodeVarName);
          }

          // Components -> schemas, responses, parameters, examples, requestBodies, headers, securitySchemas, links, callbacks

          // Named Node Child Property 
          // Paths' PathItem path
          if (ast.keyName === '^\\/' && isPatternProperty) {
            keyName = hasStandaloneName(ast) ? <string>ast.standaloneName : '??3';
            standAloneName = hasStandaloneName(ast) ? <string>ast.standaloneName : '??4';
            namedNodeVarName = 'path';
            type = generateType(ast, options);
            return generateCreateNamedNode(keyName, standAloneName, type
              , namedNodeVarName);
          }

          // HACK: get put post delete options head patch trace ... Operation's
          if (standAloneName.toLocaleLowerCase().indexOf(keyName.toLowerCase()) === -1
            && (standAloneName === 'Operation')) {
            standAloneName = keyName.substr(0, 1).toLocaleUpperCase() + keyName.substr(1, keyName.length - 1)
              + standAloneName;
            // namedNodeVarName = 'path';

            // return generateCreate(keyName, standAloneName, type);
          }

          if (standAloneName.toLocaleLowerCase().indexOf(keyName.toLowerCase()) === -1
            && (standAloneName === 'Schema')) {
            standAloneName = keyName.substr(0, 1).toLocaleUpperCase() + keyName.substr(1, keyName.length - 1)
              + standAloneName;
            // namedNodeVarName = 'path';

            // return generateCreate(keyName, standAloneName, type);
          }




          // for union types like Parameter, 1 create per nested union types at leaf node?
          return generateCreate(keyName, standAloneName, type);

        }

        // Schema - enum?: any[];
        // Schema  any, allOf, anyOf, items (OasSchema | OasReference)[];
        // Schema  not?, items? (OasSchema | OasReference);
        // OasPathItem - parameters? (OasParameter | OasReference)[];
        // OasOperation -  parameters?: (OasParameter | OasReference)[];



        // Array - Document -> servers. securityRequirements, tags
        if (ast.type === 'ARRAY' && ast.params.type !== 'STRING' && ast.params.type !== 'ANY') {
          let standAloneName: string = '??5';
          standAloneName = hasStandaloneName(ast.params) ? ast.params.standaloneName
            : generateStandaloneType(<ASTWithStandaloneName>ast.params, options);

          if (ast.params.type === 'UNION') {
            keyName = hasStandaloneName(ast.params) ? ast.params.standaloneName : keyName;
            type = generateType(ast.params.params[0], options);// generateType(ast.params, options);
            standAloneName = keyName.substr(0, 1).toLocaleUpperCase() + keyName.substr(1, keyName.length - 1)
              + ast.params.params[0].standaloneName;

            // recurse down UNION and get all leaf/INTERFACES.
            // loop through and create

            // standAloneName = keyName.substr(0, 1).toLocaleUpperCase() + keyName.substr(1, keyName.length - 1)
            //   + standAloneName;
            // HACK: change from UNION with Reference to just the one other class
            // if (type.indexOf('OasReference') > -1) {
            //   type = type.replace('(', '').replace(')', '').replace(' ', '').replace('|', '')
            //     .replace('OasReference', '');
            // }
          }
          // if (ast.params.type !== 'UNION') {


          return generateCreate(keyName, standAloneName, type);
          // } else {
          // recurse down UNION and get all leaf/INTERFACES.
          // loop through and create
          // }
        }
        return '';
      }

      )
      .join('\n')
    + '\n'

    // 5. create array?

    // 6. accept - all?
    + generateAccept(ast, generateType(ast, options))

    // add - if is array? create array if not exits?
    // remove by name - if is array? create array if not exits?
    // get by name
    // get array
    // set - single objects?
    // get property thru method like parameterName???


    + `
    
}
  `
}

function generateCreate(keyName: string, standAloneName: string,
  type: string): string {

  return `
    /**
    * Creates an OAS 3.0 ${keyName}${keyName.toLocaleLowerCase().indexOf(type.toLocaleLowerCase()) === -1 ? ' ' + type : ''} object..
    * @return {${type}}
    */
    public create${standAloneName}(): ${type} {
        let rval: ${type} = new ${type}();
        rval._ownerDocument = this._ownerDocument;
        rval._parent = this;
        return rval;
    }`;
}

function generateCreateNamedNode(keyName: string, standAloneName: string,
  type: string, namedNodeVarName: string = 'name'): string {

  return `
    /**
    * Creates an ${APP_PREFIX} ${keyName} object..
    * @return {${type}}
    */
    public create${standAloneName}(${namedNodeVarName}: string): ${type} {

        let rval: ${type} = new ${type}(${namedNodeVarName});
        rval._ownerDocument = this._ownerDocument;
        rval._parent = this;
        return rval;
    }`;
}


function generateAccept(ast: AST, type: string): string {
  return `/**
   * Accepts the given OAS node visitor and calls the appropriate method on it to visit this node.
   * @param visitor
   */
  public accept(visitor: I${APP_PREFIX}NodeVisitor): void {
    visitor.visit${ast.standaloneName}(<I${type}>this);
  }`;
}

function generateComment(comment: string): string {
  return [
    '/**',
    ...comment.split('\n').map(_ => ' * ' + _),
    ' */'
  ].join('\n')
}

function generateStandaloneEnum(ast: TEnum, options: Options): string {
  return (hasComment(ast) ? generateComment(ast.comment) + '\n' : '')
    + 'export ' + (options.enableConstEnums ? 'const ' : '') + `enum ${toSafeString(ast.standaloneName)} {`
    + '\n'
    + ast.params.map(({ ast, keyName }) =>
      keyName + ' = ' + generateType(ast, options)
    )
      .join(',\n')
    + '\n'
    + '}'
}

function generateStandaloneInterface(ast: TNamedInterface, options: Options): string {
  return (hasComment(ast) ? generateComment(ast.comment) + '\n' : '')
    + `export interface IOas${toSafeString(ast.standaloneName)} `
    + (ast.superTypes.length > 0 ? `extends ${ast.superTypes.map(superType => toSafeString(superType.standaloneName)).join(', ')} ` : '')
    + generateInterface(ast, options)
}

function generateStandaloneClass(ast: TNamedInterface, options: Options): string {
  return (hasComment(ast) ? generateComment(ast.comment) + '\n' : '')
    + `export class ${APP_PREFIX}${toSafeString(ast.standaloneName)} extends ${APP_PREFIX}ExtensibleNode implements I${APP_PREFIX}${toSafeString(ast.standaloneName)} `
    + (ast.superTypes.length > 0 ? `extends ${ast.superTypes.map(superType => toSafeString(superType.standaloneName)).join(', ')} ` : '')
    + generateClass(ast, options)
}

function generateStandaloneType(ast: ASTWithStandaloneName, options: Options): string {
  return (hasComment(ast) ? generateComment(ast.comment) + '\n' : '')
    + `export type ${APP_PREFIX}${toSafeString(ast.standaloneName)} = ${generateType(omit<AST>(ast, 'standaloneName') as AST /* TODO */, options)}`
}

function escapeKeyName(keyName: string): string {
  if (
    keyName.length
    && /[A-Za-z_$]/.test(keyName.charAt(0))
    && /^[\w$]+$/.test(keyName)
  ) {
    return keyName
  }
  if (keyName === '[k: string]') {
    return keyName
  }
  return JSON.stringify(keyName)
}

function getSuperTypesAndParams(ast: TInterface): AST[] {
  return ast.params
    .map(param => param.ast)
    .concat(ast.superTypes)
}
