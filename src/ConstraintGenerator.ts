import {ConstraintData} from './Constraint';
import FunctionGenerator from './ignoreCoverage/FunctionGenerator';
import Config from "./Config";

/**
 * These are all of the symbols used for the DSL.
 */
class Symbols {
    // general
    static readonly COND_SEPARATOR = ':';
    static readonly KEY_SEPARATOR = '.';
    static readonly ARG_SEPARATOR = ',';

    // activation
    static readonly ALWAYS = 'ALWAYS';
    static readonly WHEN = 'WHEN';

    // data access
    static readonly MODEL_PREFIX = '$';
    static readonly STATE_PREFIX = '#';
    static readonly STRING_SYMBOL = "'";

    // comparison
    static readonly LESS = '<';
    static readonly LESS_EQUAL = '<=';
    static readonly EQUAL = '==';
    static readonly NOT_EQUAL = '!=';
    static readonly GREATER_EQUAL = '>=';
    static readonly GREATER = '>';

    // arithmetic
    static readonly PLUS = '+';
    static readonly MINUS = '-';
    static readonly TIMES = '*';
    static readonly DIV = '/';
    static readonly MOD = '%';
    static readonly BRACKET_OPEN = '(';
    static readonly BRACKET_CLOSE = ')';

    // logic
    static readonly AND = '&&';
    static readonly OR = '||';

    // only the start symbol of each operator, used for parsing
    static readonly OPERATOR_START = [
        Symbols.LESS,
        Symbols.LESS_EQUAL,
        Symbols.EQUAL,
        Symbols.NOT_EQUAL,
        Symbols.GREATER_EQUAL,
        Symbols.GREATER,
        Symbols.PLUS,
        Symbols.MINUS,
        Symbols.TIMES,
        Symbols.DIV,
        Symbols.MOD,
        Symbols.BRACKET_OPEN,
        Symbols.BRACKET_CLOSE,
        Symbols.AND,
        Symbols.OR,
    ].map(symbol => symbol.charAt(0));
}

/**
 * This class manages all constraint generation and DSL specific tasks.
 */
export default class ConstraintGenerator {
    private readonly customFunctions: string[] = [];

    /**
     * Returns the object value of a nested string key such as 'test.anotherTest.value'
     * @param object object to be searched for key
     * @param keyChain key string separated by dots
     * @private
     */
    private static getObjectValue<T>(object: T, keyChain: string): any {
        try {

            if (keyChain === "") {
                return object;
            }

            let value: any = object;
            let keys = keyChain.split(Symbols.KEY_SEPARATOR);
            for (let key of keys) {
                value = value[key];
            }

            return value;
        } catch (err) {
            return 'UNDEFINED_VALUE';
        }
    }

    /**
     * For any string of the form 'abcdef(this, is a test)', this function returns the substring within the
     * parentheses, in this case 'this, is a test'.
     *
     * @param srcString string to be parsed
     * @private
     */
    private static getSubstringWithinParentheses(srcString: string): string {
        let bracketStart = srcString.indexOf(Symbols.BRACKET_OPEN) + 1;
        let bracketEnd = bracketStart;
        let numBracketsOpened = 0;
        for (let i = bracketStart; i < srcString.length; i++) {
            let char = srcString.charAt(i);
            if (char === Symbols.BRACKET_OPEN) {
                numBracketsOpened++;
            } else if (char === Symbols.BRACKET_CLOSE) {
                if (numBracketsOpened > 0) {
                    numBracketsOpened--;
                } else if (numBracketsOpened === 0) {
                    bracketEnd = i;
                    break;
                } else {
                    throw Error('Invalid syntax in token: ' + srcString);
                }
            }
        }

        return srcString.substring(bracketStart, bracketEnd);
    }

    /**
     * Checks if the given string is a valid number.
     *
     * @param string string to be checked
     * @private
     */
    private static isNumberString(string: string): boolean {
        return !!string.match(/[+-]?([0-9]*[.])?[0-9]+/);
    }

    /**
     * Checks if the given string is a string in the DSL context, in this case it has to start and end with a '.
     *
     * @param string string to be checked
     * @private
     */
    private static isString(string: string): boolean {
        return (
            string.startsWith(Symbols.STRING_SYMBOL) &&
            string.endsWith(Symbols.STRING_SYMBOL) &&
            !string.includes("`")
        );
    }

    /**
     * Checks if the given string is a model variable in the DSL context.
     *
     * @param string string to be checked
     * @private
     */
    private static isModelVariable(string: string): boolean {
        return string.startsWith(Symbols.MODEL_PREFIX);
    }

    /**
     * Checks if the given string is a state variable in the DSL context.
     *
     * @param string string to be checked
     * @private
     */
    private static isStateVariable(string: string): boolean {
        return string.startsWith(Symbols.STATE_PREFIX);
    }

    /**
     * Register a custom function.
     *
     * @param name name of the function
     */
    registerFunction(name: string) {
        if (this.customFunctions.includes(name)) {
            throw Error('Function with name ' + name + ' is already registered');
        }
        this.customFunctions.push(name);
    }

    /**
     * Checks if a specific char in a string is within a string in the DSL context. So "some 'cust<o>m' message"
     * would be true, while "some 'custom' m<e>ssage" would be false.
     *
     * @param srcString string to be checked
     * @param charIndex index of the char in string
     */
    isCharWithinString(srcString: string, charIndex: number): boolean {
        if (
            charIndex === 0 ||
            charIndex === srcString.length - 1 ||
            srcString.charAt(charIndex) === Symbols.STRING_SYMBOL
        ) {
            return false;
        }
        let numStringSymbols = 0;
        for (let i = charIndex + 1; i < srcString.length; i++) {
            let char = srcString.charAt(i);
            if (char === Symbols.STRING_SYMBOL) {
                numStringSymbols++;
            }
        }
        return numStringSymbols % 2 === 1;
    }

    /**
     * For a given opening bracket, finds the corresponding closing bracket in a string.
     *
     * @param openingBracketIndex index of the opening bracket
     * @param srcString string to be searched
     * @private
     */
    private static getClosingBracketIndex(openingBracketIndex: number, srcString: string): number {
        let numBrackets = 1;
        let closingBracketIndex = -1;
        for (let j = openingBracketIndex + 1; j < srcString.length; j++) {
            let currentChar = srcString.charAt(j);
            if (currentChar === '(') {
                numBrackets++;
            } else if (currentChar === ')') {
                numBrackets--;
            }
            if (numBrackets === 0) {
                closingBracketIndex = j;
                break;
            }
        }
        return closingBracketIndex;
    }

    /**
     * Returns a list of all indices where the given char occurs in the given string.
     *
     * @param char char to be searched for
     * @param srcString string to be searched
     * @private
     */
    private static findAllIndicesOf(char: string, srcString: string): number[] {
        let res: number[] = [];
        for (let i = 0; i < srcString.length; i++) {
            let currentChar = srcString.charAt(i);
            if (currentChar === char) {
                res.push(i);
            }
        }
        return res;
    }

    /**
     * Checks if a specific char of a string is within a function in the DSL context. So "SOME_FUNCTION(a, t<e>st)"
     * would be true, while "SOME_FUNCTI<O>N(a, test)" would be false.
     *
     * @param srcString string to be checked
     * @param charIndex index of the char in string
     */
    isCharWithinFunction(srcString: string, charIndex: number): boolean {
        let char = srcString.charAt(charIndex);
        if (
            charIndex === 0 ||
            charIndex === srcString.length - 1 ||
            char === '(' ||
            char === ')'
        ) {
            return false;
        }

        let openingBracketIndices: number[] = ConstraintGenerator.findAllIndicesOf('(', srcString);

        for (let openingBracketIndex of openingBracketIndices) {
            // we dont care if the bracket was the first char, because then it cannot be a function
            if (openingBracketIndex === 0) {
                continue;
            }

            let leftCharOfOpeningBracket = srcString.charAt(openingBracketIndex - 1);

            // we have a function, now look for its enclosing bracket
            if (leftCharOfOpeningBracket.match(/\w/g)) {
                let closingBracketIndex = ConstraintGenerator.getClosingBracketIndex(openingBracketIndex, srcString);
                if (closingBracketIndex === -1) {
                    throw Error('Syntax error in function: ' + srcString);
                }
                if (
                    charIndex > openingBracketIndex &&
                    charIndex < closingBracketIndex
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Cuts off the end of a string, until a given regex is reached.
     *
     * @param srcString string to be cut
     * @param charRegex stop regex
     */
    cutRemainderUntilCharMatches(srcString: string, charRegex: RegExp): string {
        let endIndex = srcString.length - 1;
        let char = srcString.charAt(endIndex);
        while (!char.match(charRegex) && endIndex > 0) {
            char = srcString.charAt(--endIndex);
        }
        return srcString.substring(0, endIndex + 1);
    }

    /**
     * Cuts off the front of a string, until a given regex is reached.
     *
     * @param srcString string to be cut
     * @param charRegex stop regex
     */
    cutFrontUntilCharMatches(srcString: string, charRegex: RegExp): string {
        let startIndex = 0;
        let char = srcString.charAt(startIndex);
        while (!char.match(charRegex) && startIndex < srcString.length - 1) {
            char = srcString.charAt(++startIndex);
        }
        return srcString.substring(startIndex);
    }

    /**
     * Returns a tokenized version of a message string, split according to DSL syntax.
     *
     * @param srcString string to be tokenized
     */
    getMessageTokens(srcString: string): string[] {
        let modelRegex = new RegExp('\\' + Symbols.MODEL_PREFIX, 'g');
        let stateRegex = new RegExp('\\' + Symbols.STATE_PREFIX, 'g');

        let res: string[] = [];
        let tokenStart = 0;
        for (let i = 0; i < srcString.length - 1; i++) {
            let char = srcString.charAt(i);
            let nextChar = srcString.charAt(i + 1);

            // start of a word that is not the argument of a function call
            if (
                char.match(/\s/g) &&
                nextChar.match(/^(?!.*\s).*$/g) &&
                !this.isCharWithinFunction(srcString, i)
            ) {
                tokenStart = i + 1;
            }

            // we have the end of a word that is not an argument of a function call
            if (
                char.match(/^(?!.*\s).*$/g) &&
                nextChar.match(/\s/g) &&
                !this.isCharWithinFunction(srcString, i)
            ) {
                res.push(srcString.substring(tokenStart, i + 1));
            }

            if (i === srcString.length - 2) {
                res.push(srcString.substring(tokenStart, i + 2));
            }
        }

        for (let i = 0; i < res.length; i++) {
            let token = res[i];
            if (this.isStatementToken(token)) {
                res[i] = this.cutRemainderUntilCharMatches(token, /\w/g);
            } else if (this.isFunctionToken(token)) {
                res[i] = this.cutRemainderUntilCharMatches(token, /\)/g);
            } else if (token.includes(Symbols.MODEL_PREFIX)) {
                let trimmed = this.cutRemainderUntilCharMatches(token, /\w/g);
                trimmed = this.cutFrontUntilCharMatches(trimmed, modelRegex);
                res[i] = trimmed;
            } else if (token.includes(Symbols.STATE_PREFIX)) {
                let trimmed = this.cutRemainderUntilCharMatches(token, /\w/g);
                trimmed = this.cutFrontUntilCharMatches(trimmed, stateRegex);
                res[i] = trimmed;
            }
        }

        return res;
    }

    /**
     * Splits a DSL string into activation and condition token.
     *
     * @param srcString string to be split
     */
    getSplitTokens(srcString: string): string[] {
        let splitIndex = -1;
        for (let i = 0; i < srcString.length; i++) {
            let char = srcString.charAt(i);
            if (
                char === Symbols.COND_SEPARATOR &&
                !this.isCharWithinString(srcString, i)
            ) {
                splitIndex = i;
                break;
            }
        }
        if (splitIndex === -1) {
            throw Error('Invalid syntax for token: ' + srcString);
        }
        let res: string[] = [];
        res.push(srcString.substring(0, splitIndex));
        res.push(srcString.substring(splitIndex + 1));
        return res;
    }

    /**
     * Generates a function from given constraint data. This is safe, since the resource string is
     * entirely replaced by a pre-defined syntax when the function is created.
     *
     * @param resource constraint data
     */
    generateFunction<T extends ConstraintData>(resource: T): Function {

        if (Config.DEBUG_LOG) {
            console.log('Starting constraint generation with data: ', resource);
        }

        let assertion = resource.assertion;
        let tokens = this.getSplitTokens(assertion);

        let activationToken = tokens[0].trim();
        let conditionToken = tokens[1].trim();

        if (Config.DEBUG_LOG) {
            console.log("Activation token: ", activationToken);
            console.log("Condition token: ", conditionToken);
        }

        let activationString = 'false';

        if (activationToken.startsWith(Symbols.ALWAYS)) {
            activationString = 'true';
        } else if (activationToken.startsWith(Symbols.WHEN)) {
            let activationData = ConstraintGenerator.getSubstringWithinParentheses(activationToken);
            activationString = this.generateConditionalString(activationData);
        } else if (this.isStatementToken(activationToken)) {
            activationString = `this.functions['${activationToken}'](this.model,this.state)`;
        }

        let conditionString = this.generateConditionalString(conditionToken);
        let functionString = `if(${activationString}){return(${conditionString});}else{return(true);}`;

        if (Config.DEBUG_LOG) {
            console.log('Generated constraint: ', functionString);
        }

        return FunctionGenerator.generateFromString(functionString);
    }

    /**
     * For a given data access index ($, #), return the end index of that value.
     *
     * @param trimmed string to be searched
     * @param startIndex start index
     * @param endIndex end index
     * @private
     */
    private static getDataAccessEndIndex(trimmed: string, startIndex: number, endIndex: number): number {
        let end = endIndex;
        for (let i = startIndex + 1; i < trimmed.length; i++) {
            let endChar = trimmed.charAt(i);
            if (i === trimmed.length - 1) {
                end = i + 1;
                break;
            } else if (!endChar.match(/\w|\./g)) {
                end = i;
                break;
            }
        }
        return end;
    }

    /**
     * For a given string index, return the end index of that string.
     *
     * @param trimmed string to be searched
     * @param startIndex start index
     * @param endIndex end index
     * @private
     */
    private static getStringEndIndex(trimmed: string, startIndex: number, endIndex: number): number {
        let end = endIndex;
        for (let i = startIndex + 1; i < trimmed.length; i++) {
            let endChar = trimmed.charAt(i);
            if (endChar === Symbols.STRING_SYMBOL) {
                end = i + 1;
                break;
            }
        }
        return end;
    }

    /**
     * For a given number index, return the end index of that number.
     *
     * @param trimmed string to be searched
     * @param startIndex start index
     * @param endIndex end index
     * @private
     */
    private static getNumberEndIndex(trimmed: string, startIndex: number, endIndex: number): number {
        let end = endIndex;
        for (let i = startIndex; i < trimmed.length; i++) {
            let endChar = trimmed.charAt(i);
            if (i === trimmed.length - 1) {
                end = i + 1;
                break;
            } else if (!endChar.match(/[0-9]|\./g)) {
                end = i;
                break;
            }
        }
        return end;
    }

    /**
     * For a given function index, return the end index of that function.
     *
     * @param trimmed string to be searched
     * @param startIndex start index
     * @param endIndex end index
     * @private
     */
    private static getFunctionEndIndex(trimmed: string, startIndex: number, endIndex: number): number {
        let end = endIndex;
        let numBrackets = 0;
        let foundFirst = false;
        for (let i = startIndex + 1; i < trimmed.length; i++) {
            let endChar = trimmed.charAt(i);
            if (endChar === '(') {
                numBrackets++;
                foundFirst = true;
            } else if (endChar === ')') {
                numBrackets--;
            }
            if (foundFirst && numBrackets === 0) {
                end = i + 1;
                break;
            }
            if (numBrackets === 0 && !endChar.match(/\w/g)) {
                foundFirst = true;
                end = i;
                break;
            }
        }

        // no brackets, so this is a statement
        if (!foundFirst) {
            return ConstraintGenerator.getStatementEndIndex(trimmed, startIndex, endIndex);
        }
        return end;
    }

    /**
     * For a given statement index, return the end index of that statement.
     *
     * @param trimmed string to be searched
     * @param startIndex start index
     * @param endIndex end index
     * @private
     */
    private static getStatementEndIndex(trimmed: string, startIndex: number, endIndex: number): number {
        let end = endIndex;
        for (let i = startIndex + 1; i < trimmed.length; i++) {
            let endChar = trimmed.charAt(i);
            if (i === trimmed.length - 1) {
                end = i + 1;
                break;
            } else if (!endChar.match(/\w/g)) {
                end = i;
                break;
            }
        }
        return end;
    }

    /**
     * For a given operator index, return the end index of that operator.
     *
     * @param trimmed string to be searched
     * @param startChar start char
     * @param startIndex start index
     * @param endIndex end index
     * @private
     */
    private static getOperatorEndIndex(trimmed: string, startChar: string, startIndex: number, endIndex: number): number {

        let end = endIndex;

        // this definitely needs to be refactored at some point
        if (
            startChar === '<' ||
            startChar === '>' ||
            startChar === '!' ||
            startChar === '='
        ) {
            let nextChar = trimmed[startIndex + 1];
            end = startIndex + (nextChar === '=' ? 2 : 1);
        } else if (startChar === '&' || startChar === '|') {
            end = startIndex + 2;
        } else if (
            startChar === '(' ||
            startChar === ')' ||
            startChar === '+' ||
            startChar === '-' ||
            startChar === '*' ||
            startChar === '/' ||
            startChar === '%'
        ) {
            end = startIndex + 1;
        }
        return end;
    }

    /**
     * Generates a pre-defined conditional javascript code string from assertion data.
     *
     * @param data assertion data
     * @private
     */
    private generateConditionalString(data: string): string {
        let trimmed = data.replace(/\s/g, '');

        let tokens: string[] = [];
        let done = false;
        let startIndex = 0;
        let endIndex = 0;
        let iterations = 0;
        while (!done) {
            let startChar = trimmed[startIndex];

            // we have data access, so look for the char of the next statement to find the end index
            if (
                startChar === Symbols.MODEL_PREFIX ||
                startChar === Symbols.STATE_PREFIX
            ) {
                endIndex = ConstraintGenerator.getDataAccessEndIndex(trimmed, startIndex, endIndex);

                // we have a string here, so just look for the end string quotation to find the end index
            } else if (startChar === Symbols.STRING_SYMBOL) {
                endIndex = ConstraintGenerator.getStringEndIndex(trimmed, startIndex, endIndex);

                // we have a number, so look for the next char that is not a dot or a number to find the end index
            } else if (startChar.match(/[0-9]/g)) {
                endIndex = ConstraintGenerator.getNumberEndIndex(trimmed, startIndex, endIndex);

                // we have a function, so look for the last closing bracket to find the end index
            } else if (this.isFunctionToken(trimmed.substring(startIndex))) {
                endIndex = ConstraintGenerator.getFunctionEndIndex(trimmed, startIndex, endIndex);

                // we have some sort of operator here, we must do this by hand unfortunately
            } else if (Symbols.OPERATOR_START.includes(startChar)) {

                endIndex = ConstraintGenerator.getOperatorEndIndex(trimmed, startChar, startIndex, endIndex);
            } else {
                throw Error(
                    'Unable to parse statement: ' +
                    data +
                    ', char: ' +
                    startChar +
                    ', index: ' +
                    startIndex
                );
            }

            tokens.push(trimmed.substring(startIndex, endIndex));
            startIndex = endIndex;

            if (startIndex >= trimmed.length) {
                done = true;
            }

            if (iterations++ > 1000) {
                throw Error(
                    'Maximum number of parsing iterations reached, there is a syntax error here: ' +
                    data
                );
            }
        }

        return this.getStringFromTokens(tokens);
    }

    /**
     * Returns a conditional javascript string given a token array.
     *
     * @param tokens token array
     * @private
     */
    private getStringFromTokens(tokens: string[]): string {
        if (Config.DEBUG_LOG) {
            console.log("Original tokens: ", tokens);
        }

        let condString = '';
        for (let token of tokens) {
            let symbol = this.getSymbolForToken(token);
            condString += symbol;
            if (Config.DEBUG_LOG) {
                console.log("Original: ", token, " Parsed: ", symbol);
            }
        }

        return condString;
    }

    /**
     * Checks if a given string is a function in the DSL context.
     *
     * @param token string to be checked
     * @private
     */
    private isFunctionToken(token: string): boolean {
        for (let functionName of this.customFunctions) {
            if (token.startsWith(functionName)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks if a given string is a statement in the DSL context.
     *
     * @param token string to be checked
     * @private
     */
    private isStatementToken(token: string): boolean {
        return (
            this.isFunctionToken(token) &&
            !token.includes('(') &&
            !token.includes(')')
        );
    }

    /**
     * Splits up a string of arguments into tokens.
     *
     * @param argString argument string to be split
     * @private
     */
    private static getFunctionArgs(argString: string): string[] {
        let trimmed = argString.replace(/\s/g, '');

        let res: string[] = [];
        let startIndex = 0;
        let numBrackets = 0;
        for (let i = startIndex; i < trimmed.length; i++) {
            let char = trimmed[i];
            if (char === Symbols.BRACKET_OPEN) {
                numBrackets++;
            } else if (char === Symbols.BRACKET_CLOSE) {
                numBrackets--;
                if (numBrackets === 0 && i === trimmed.length - 1) {
                    res.push(trimmed.substring(startIndex, i + 1));
                }
            } else if ((char === Symbols.ARG_SEPARATOR || i === trimmed.length - 1) && numBrackets === 0) {
                // now we have reached the end of an argument
                let endIndex = i === trimmed.length - 1 ? i + 1 : i;
                res.push(trimmed.substring(startIndex, endIndex));
                startIndex = i + 1;
            }
        }

        return res;
    }

    /**
     * Converts a function token to the corresponding javascript syntax.
     *
     * @param token function to be converted
     * @private
     */
    private parseFunctionToken(token: string): string {
        let funName = token.split('(')[0];
        let argString = ConstraintGenerator.getSubstringWithinParentheses(token);
        let args = ConstraintGenerator.getFunctionArgs(argString);
        let argSymbols = '';
        for (let i = 0; i < args.length; i++) {
            let arg = args[i];
            let symbol = this.getSymbolForToken(arg);
            argSymbols += symbol;
            if (i < args.length - 1) {
                argSymbols += ',';
            }
        }

        return `this.functions['${funName}'](${argSymbols})`;
    }

    private getSymbolForToken(token: string): string {
        if (ConstraintGenerator.isModelVariable(token)) {
            if (token.length === 1) {
                return 'this.model';
            }
            return token.replace(Symbols.MODEL_PREFIX, 'this.model.');
        } else if (ConstraintGenerator.isStateVariable(token)) {
            if (token.length === 1) {
                return 'this.state';
            }
            return token.replace(Symbols.STATE_PREFIX, 'this.state.');
        } else if (this.isStatementToken(token)) {
            return `this.functions['${token}'](this.model, this.state)`;
        } else if (this.isFunctionToken(token)) {
            return this.parseFunctionToken(token);
        } else if (ConstraintGenerator.isString(token)) {
            return token;
        } else if (ConstraintGenerator.isNumberString(token)) {
            return token;
        } else {
            // this seems unnecessary, but it is more secure since it replaces all unknown tokens
            switch (token) {
                case Symbols.LESS:
                    return '<';
                case Symbols.LESS_EQUAL:
                    return '<=';
                case Symbols.EQUAL:
                    return '==';
                case Symbols.NOT_EQUAL:
                    return '!=';
                case Symbols.GREATER_EQUAL:
                    return '>=';
                case Symbols.GREATER:
                    return '>';
                case Symbols.PLUS:
                    return '+';
                case Symbols.MINUS:
                    return '-';
                case Symbols.TIMES:
                    return '*';
                case Symbols.DIV:
                    return '/';
                case Symbols.MOD:
                    return '%';
                case Symbols.BRACKET_OPEN:
                    return '(';
                case Symbols.BRACKET_CLOSE:
                    return ')';
                case Symbols.AND:
                    return '&&';
                case Symbols.OR:
                    return '||';
                default:
                    return '';
            }
        }
    }

    /**
     * Returns a converted message string by replacing function calls or model and state variables with their
     * actual current value.
     *
     * @param msgString string to be converted
     * @param model model
     * @param state state
     * @param functions functions
     */
    getMessage<M, S>(
        msgString: string,
        model: M,
        state: S,
        functions: { [key: string]: Function }
    ): string {
        let message = msgString.slice();
        let tokens = this.getMessageTokens(message);

        let modelKeys = this.getFilteredTokenArray(tokens, Symbols.MODEL_PREFIX);
        let stateKeys = this.getFilteredTokenArray(tokens, Symbols.STATE_PREFIX);

        for (let modelKey of modelKeys) {
            let modelKeyWithPrefix = Symbols.MODEL_PREFIX + modelKey;
            message = message.replace(
                modelKeyWithPrefix,
                ConstraintGenerator.getObjectValue(model, modelKey)
            );
        }

        for (let stateKey of stateKeys) {
            let stateKeyWithPrefix = Symbols.STATE_PREFIX + stateKey;
            message = message.replace(
                stateKeyWithPrefix,
                ConstraintGenerator.getObjectValue(state, stateKey)
            );
        }

        for (let token of tokens) {
            if (this.isStatementToken(token)) {
                let statementValue = functions[token](model, state);
                message = message.replace(token, statementValue);
            } else if (this.isFunctionToken(token)) {
                let functionValue = this.evaluateFunction(
                    token,
                    model,
                    state,
                    functions
                );
                message = message.replace(token, functionValue);
            }
        }

        return message;
    }

    /**
     * Replaces a function token with its actual current value.
     *
     * @param token function token
     * @param model model
     * @param state state
     * @param functions functions
     * @private
     */
    private evaluateFunction<M, S>(
        token: string,
        model: M,
        state: S,
        functions: { [key: string]: Function }
    ): any {
        let stringRegex = new RegExp('\\' + Symbols.STRING_SYMBOL, 'g');
        let functionName = token.split('(')[0];
        let functionArgs = ConstraintGenerator.getSubstringWithinParentheses(token);
        let argsStrings = ConstraintGenerator.getFunctionArgs(functionArgs);
        let args: any[] = [];
        for (let argsString of argsStrings) {
            if (this.isStatementToken(argsString)) {
                args.push(functions[argsString](model, state));
            } else if (this.isFunctionToken(argsString)) {
                args.push(this.evaluateFunction(argsString, model, state, functions));
            } else if (ConstraintGenerator.isModelVariable(argsString)) {
                args.push(
                    ConstraintGenerator.getObjectValue(
                        model,
                        argsString.replace(Symbols.MODEL_PREFIX, '')
                    )
                );
            } else if (ConstraintGenerator.isStateVariable(argsString)) {
                args.push(
                    ConstraintGenerator.getObjectValue(
                        state,
                        argsString.replace(Symbols.STATE_PREFIX, '')
                    )
                );
            } else if (ConstraintGenerator.isString(argsString)) {
                args.push(argsString.replace(stringRegex, ''));
            } else if (ConstraintGenerator.isNumberString(argsString)) {
                args.push(Number.parseFloat(argsString));
            }
        }

        return functions[functionName](...args);
    }

    /**
     * Returns only those tokens that start with a specific prefix, and removes that prefix
     *
     * @param tokens tokens to be filtered
     * @param tokenPrefix prefix to be removed
     * @private
     */
    private getFilteredTokenArray(
        tokens: string[],
        tokenPrefix: string
    ): string[] {
        return tokens
            .filter(token => token.startsWith(tokenPrefix))
            .map(token => token.replace(tokenPrefix, ''));
    }
}
